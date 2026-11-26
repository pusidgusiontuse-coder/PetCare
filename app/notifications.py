"""Run every minute with cron. Sends Web Push independently of open browsers."""
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from database import SessionLocal
import models
from features import send_email
from login_guard import insert_if_absent

MSK=ZoneInfo('Europe/Moscow')
TYPE_NAMES={'feeding':'Кормление','medicine':'Препарат','procedure':'Процедура','vet_visit':'Ветеринар','walk':'Прогулка'}

def due_occurrence(r, now):
    """Daily/monthly repeats derive from original anchor without drifting dates."""
    raw=r.at or f'{r.due_date.isoformat()}T{r.due_time or "09:00"}'
    try:
        anchor=datetime.fromisoformat(raw)
        if not anchor.tzinfo: anchor=anchor.replace(tzinfo=MSK)
        anchor=anchor.astimezone(MSK)
    except (ValueError,TypeError): return None
    if r.interval_days and r.interval_days>0:
        n=max(0,(now.date()-anchor.date()).days//r.interval_days)
        due=anchor+timedelta(days=n*r.interval_days)
    elif r.interval_months and r.interval_months>0:
        months=(now.year-anchor.year)*12+now.month-anchor.month
        n=max(0,months//r.interval_months)*r.interval_months
        year,month=divmod(anchor.year*12+anchor.month-1+n,12)
        import calendar
        due=anchor.replace(year=year,month=month+1,day=min(anchor.day,calendar.monthrange(year,month+1)[1]))
    else: due=anchor
    if r.status in ('completed','skipped'): return None
    return due if timedelta(0)<=now-due<=timedelta(hours=12) else None


def send_web_push(subscription, title, body, tag, page='pets', timeout=15):
    from pywebpush import webpush
    webpush(subscription_info=json.loads(subscription.data),
            data=json.dumps({'title': title, 'body': body[:200], 'tag': tag, 'page': page}, ensure_ascii=False),
            vapid_private_key=os.environ['VAPID_PRIVATE_KEY'],
            vapid_claims={'sub': os.getenv('VAPID_SUBJECT', 'mailto:webmaster@naumenkoilia.ru')},
            timeout=timeout)


def send_broadcasts(db):
    if not os.getenv('VAPID_PRIVATE_KEY'):
        return
    from pywebpush import WebPushException
    notice, sub, user, delivery = models.InboxNotice, models.PushSubscription, models.User, models.BroadcastDelivery
    now = datetime.utcnow()
    pending = (db.query(notice.id, sub.id)
               .select_from(notice)
               .join(user, or_(user.created_at.is_(None), user.created_at <= notice.created_at))
               .join(sub, sub.user_id == user.id)
               .outerjoin(delivery, and_(delivery.notice_id == notice.id, delivery.subscription_id == sub.id))
               .filter(notice.user_id.is_(None), notice.created_at >= now - timedelta(days=7),
                       user.disabled.is_(False), or_(delivery.notice_id.is_(None), delivery.retry_at <= now))
               .order_by(notice.id, sub.id).limit(25).all())

    for notice_id, subscription_id in pending:
        key = (notice_id, subscription_id)
        claim = db.get(delivery, key, with_for_update=True)
        if claim and (claim.retry_at is None or claim.retry_at > now):
            db.rollback()
            continue
        if claim is None:
            claim = delivery(notice_id=notice_id, subscription_id=subscription_id)
            db.add(claim)
        claim.retry_at = now + timedelta(minutes=10)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            continue

        item, target = db.get(notice, notice_id), db.get(sub, subscription_id)
        if item is None or target is None:
            continue
        pref = db.get(models.NotificationPreference, target.user_id)
        settings = json.loads(pref.data) if pref else {}
        try:
            if settings.get('backgroundPushEnabled', True):
                send_web_push(target, item.title, item.body, f'broadcast:{notice_id}', 'profile', timeout=5)
        except WebPushException as exc:
            if exc.response is not None and exc.response.status_code in (404, 410):
                db.delete(target)
                db.commit()
            continue
        except Exception:
            continue
        claim.retry_at = None
        db.commit()


def run(now=None):
    now=now or datetime.now(MSK)
    if not now.tzinfo: now=now.replace(tzinfo=MSK)
    from pywebpush import WebPushException
    with SessionLocal() as db:
        send_broadcasts(db)
        events=[]
        for r in db.query(models.Reminder).all():
            due=due_occurrence(r,now)
            if due: events.append((r.pet_id,f'reminder:{r.id}:{due.isoformat()}',r.title,TYPE_NAMES.get(r.reminder_type,'Процедура')))
        # Daily meals and active prescriptions at explicit HH:MM times.
        for cls,field,title,kind in [
            (models.MealPlan, 'time', 'Кормление', 'Кормление'),
            (models.MealPlan, 'end_time', 'Конец интервала кормления', 'Кормление'),
            (models.Prescription, 'times', 'Приём препарата', 'Препарат'),
        ]:
            for row in db.query(cls).all():
                if cls is models.MealPlan:
                    day = now.date()
                    if field == 'end_time' and row.end_time and row.end_time < row.time:
                        day -= timedelta(days=1)
                    if row.completed_on == day.isoformat(): continue
                if cls is models.Prescription:
                    if row.status!='Активно' or row.start_date>now.date(): continue
                    days=re.search(r'(\d+)\s*(?:дн|день|дней)',row.duration or '')
                    if days and now.date()>=row.start_date+timedelta(days=int(days.group(1))): continue
                for t in re.findall(r'\b(?:[01]\d|2[0-3]):[0-5]\d\b',getattr(row,field) or ''):
                    due=datetime.combine(now.date(),datetime.strptime(t,'%H:%M').time(),MSK)
                    if timedelta(0)<=now-due<timedelta(minutes=10):
                        event_key = f'{cls.__tablename__}:{row.id}:{due.isoformat()}'
                        if field == 'end_time': event_key += ':end'
                        events.append((row.pet_id, event_key, title, kind))
        for pet_id,event_key,title,kind in events:
            pet=db.get(models.Pet,pet_id)
            if not pet: continue
            ids={pet.owner_id}|{m.user_id for m in pet.members if m.role in {'viewer', 'editor', 'co_owner'} and (not m.expires_at or m.expires_at > datetime.utcnow())}
            for uid in ids:
                user=db.get(models.User,uid)
                if not user or user.disabled: continue
                pref=db.get(models.NotificationPreference,uid); settings=json.loads(pref.data) if pref else {}
                if kind not in settings.get('types',['Кормление','Препарат','Процедура','Ветеринар','Прогулка']): continue
                key = hashlib.sha256(f'inbox:{uid}:{event_key}'.encode()).hexdigest()
                if not db.query(models.InboxNotice.id).filter_by(key=key).first():
                    insert_if_absent(db, models.InboxNotice.__table__, key, user_id=uid, title=kind,
                                     body=f'{pet.name}: {title}', created_at=datetime.utcnow())
                    db.commit()
                if settings.get('quietEnabled'):
                    a,b=settings.get('quietStart','22:00'),settings.get('quietEnd','08:00'); t=now.strftime('%H:%M')
                    if (a<=t<b if a<b else t>=a or t<b): continue
                destinations=[]
                if settings.get('backgroundPushEnabled', True):
                    destinations.extend(('push',s) for s in db.query(models.PushSubscription).filter(models.PushSubscription.user_id==uid).all())
                if settings.get('emailEnabled') and user and user.email_verified: destinations.append(('email',user))
                for channel,target in destinations:
                    endpoint=target.endpoint if channel=='push' else target.email
                    key=hashlib.sha256(f'{uid}:{event_key}:{endpoint}'.encode()).hexdigest()
                    # Reserve before delivery: competing cron processes cannot double-send.
                    try: db.add(models.DeliveryReceipt(key=key)); db.commit()
                    except IntegrityError: db.rollback(); continue
                    try:
                        if channel=='push':
                            if not os.getenv('VAPID_PRIVATE_KEY'): raise RuntimeError('Push keys not configured')
                            send_web_push(target, 'PetCare', f'{pet.name}: {title}', key)
                        else: send_email(target.email,'Напоминание PetCare',f'{pet.name}: {title}')
                    except WebPushException as e:
                        if e.response is not None and e.response.status_code in (404,410): db.delete(target)
                        db.query(models.DeliveryReceipt).filter_by(key=key).delete(); db.commit()
                    except Exception:
                        db.query(models.DeliveryReceipt).filter_by(key=key).delete(); db.commit()
        # Do not retain expired one-time account challenges or private undo data indefinitely.
        db.query(models.EmailChallenge).filter(models.EmailChallenge.expires_at<datetime.utcnow()-timedelta(days=1)).delete()
        db.query(models.RecoveryAction).filter(models.RecoveryAction.expires_at<datetime.utcnow()).delete()
        db.query(models.LoginSession).filter(models.LoginSession.expires_at<datetime.utcnow()-timedelta(days=1)).delete()
        db.query(models.DeliveryReceipt).filter(models.DeliveryReceipt.sent_at<datetime.utcnow()-timedelta(days=90)).delete()
        db.commit()

if __name__=='__main__': run()
