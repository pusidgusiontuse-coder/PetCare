"""Account security, shared access, preferences and reversible actions."""
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import uuid
import time
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text, or_, update
from sqlalchemy.exc import IntegrityError
import models
from database import get_db
from settings import SECRET_KEY


def send_email(address, subject, body):
    host = os.getenv('SMTP_HOST', '')
    sender = os.getenv('SMTP_FROM', '')
    if not host or not sender:
        raise HTTPException(503, 'Почта ещё не подключена администратором. Отправить код пока невозможно.')
    msg = EmailMessage()
    msg['From'], msg['To'], msg['Subject'] = sender, address, subject
    msg.set_content(body)
    try:
        port = int(os.getenv('SMTP_PORT', '465'))
        cls = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
        with cls(host, port, timeout=15) as smtp:
            if port != 465:
                smtp.starttls()
            if os.getenv('SMTP_USER'):
                smtp.login(os.environ['SMTP_USER'], os.environ.get('SMTP_PASSWORD', ''))
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException, ValueError) as e:
        raise HTTPException(503, 'Не удалось отправить письмо. Повторите позже.') from e


def normalize_email(value):
    value = value.strip().lower()
    try: value.encode('utf-8')
    except UnicodeError: raise ValueError('Введите корректную электронную почту') from None
    if len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise ValueError('Введите корректную электронную почту')
    return value


def password_ok(value):
    try: length = len(value.encode('utf8'))
    except UnicodeError: raise HTTPException(422, 'Пароль содержит недопустимые символы') from None
    if len(value) < 8 or length > 72:
        raise HTTPException(422, 'Пароль: минимум 8 символов, максимум 72 байта.')
    return value


class CodeRequest(BaseModel):
    email: str
    purpose: str = 'password_reset'
    current_password: str | None = None
    new_email: str | None = None
    @field_validator('email')
    @classmethod
    def valid_email(cls, value): return normalize_email(value)

class CodeConfirm(BaseModel):
    challenge_id: str
    code: str = Field(min_length=6, max_length=6)
    new_password: str | None = None

class Registration(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    email: str
    password: str
    timezone: str = 'Europe/Moscow'
    @field_validator('email')
    @classmethod
    def valid_email(cls, value): return normalize_email(value)

class LoginInput(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)

class ProfileChange(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = None
    password: str | None = None
    timezone: str | None = None

class MemberChange(BaseModel):
    email: str
    role: str = 'viewer'
    expires_at: datetime | None = None

class PreferenceInput(BaseModel):
    quietEnabled: bool = False
    quietStart: str = '22:00'
    quietEnd: str = '08:00'
    types: list[str] = ['Кормление', 'Препарат', 'Процедура', 'Ветеринар', 'Прогулка']
    emailEnabled: bool = False
    @field_validator('quietStart', 'quietEnd')
    @classmethod
    def valid_time(cls, v):
        if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', v): raise ValueError('Неверное время')
        return v


def digest(challenge_id, code):
    return hmac.new(SECRET_KEY.encode(), f'{challenge_id}:{code}'.encode(), hashlib.sha256).hexdigest()


def enforce_quota(db, key, limit):
    # Atomic counter, shared by processes (also used for OCR and email abuse limits).
    quota = models.RequestQuota.__table__
    if db.get_bind().dialect.name == 'mysql':
        from sqlalchemy.dialects.mysql import insert
        statement = insert(quota).values(key=key, count=0)
        db.execute(statement.on_duplicate_key_update(count=quota.c.count))
    else:
        db.execute(text('INSERT INTO request_quotas (key, count) VALUES (:key, 0) ON CONFLICT (key) DO NOTHING'), {'key': key})
    result = db.execute(update(quota).where(quota.c.key == key, quota.c.count < limit).values(count=quota.c.count + 1))
    db.commit()
    if result.rowcount != 1: raise HTTPException(429, 'Лимит попыток исчерпан. Попробуйте позже.')


def issue_code(db, email, purpose, user_id=None, payload=None):
    now = datetime.utcnow()
    recent = db.query(models.EmailChallenge).filter(models.EmailChallenge.email == email, models.EmailChallenge.created_at > now-timedelta(seconds=60)).first()
    if recent: raise HTTPException(429, 'Повторный код можно запросить через минуту.')
    enforce_quota(db, 'mail:'+hashlib.sha256(email.encode()).hexdigest()+':'+now.strftime('%Y%m%d'), 15)
    code, cid = f'{secrets.randbelow(1000000):06d}', secrets.token_urlsafe(24)
    item = models.EmailChallenge(id=cid, email=email, purpose=purpose, user_id=user_id, code_hash=digest(cid, code), payload=json.dumps(payload or {}), expires_at=now+timedelta(minutes=10))
    # Send before recording success. Never expose codes or passwords in logs/responses.
    send_email(email, 'Код подтверждения PetCare', f'Ваш код PetCare: {code}\nДействует 10 минут. Если вы не запрашивали код, проигнорируйте письмо.')
    db.query(models.EmailChallenge).filter(models.EmailChallenge.email == email, models.EmailChallenge.purpose == purpose).update({'consumed': True})
    db.add(item); db.commit()
    return {'verification_required': True, 'challenge_id': cid, 'expires_in': 600, 'message': 'Если адрес зарегистрирован, письмо с кодом отправлено.'}


def consume_code(db, data):
    item = db.get(models.EmailChallenge, data.challenge_id)
    if not item or item.consumed or item.expires_at < datetime.utcnow() or item.attempts >= 5:
        raise HTTPException(400, 'Код недействителен или истёк. Запросите новый.')
    changed = db.execute(update(models.EmailChallenge).where(models.EmailChallenge.id==item.id, models.EmailChallenge.attempts<5, models.EmailChallenge.consumed==False).values(attempts=models.EmailChallenge.attempts+1))
    db.commit()
    if changed.rowcount != 1 or not hmac.compare_digest(item.code_hash, digest(item.id, data.code)):
        raise HTTPException(400, 'Неверный код.')
    claimed = db.execute(update(models.EmailChallenge).where(models.EmailChallenge.id==item.id, models.EmailChallenge.consumed==False).values(consumed=True))
    if claimed.rowcount != 1:
        db.rollback(); raise HTTPException(400, 'Код уже использован.')
    # Consumption and the protected account change commit in one transaction.
    return item


def premium(u):
    return bool(u.premium_permanent or (u.premium_until and u.premium_until > datetime.utcnow()))

def enforce_pet_limit(db, user):
    if premium(user): return
    own=db.query(models.Pet).filter(models.Pet.owner_id==user.id).count()
    shared=db.query(models.PetMember).filter(models.PetMember.user_id==user.id,or_(models.PetMember.expires_at.is_(None),models.PetMember.expires_at>datetime.utcnow())).count()
    if own+shared>=3: raise HTTPException(403,'В бесплатной версии можно добавить до трёх питомцев. Для большего количества нужен платный доступ.')

def user_json(u):
    return dict(id=u.id, full_name=u.full_name, email=u.email, timezone=u.timezone, email_verified=u.email_verified, is_admin=u.is_admin, disabled=u.disabled, premium=premium(u), premium_until=u.premium_until.isoformat() if u.premium_until else None)


def reminder_transition(db, reminder, previous):
    """Record an undo action and create the next recurrence once, on the server."""
    import calendar
    values={'kind':'reminder','id':reminder.id,'previous':previous,'next_id':None}
    if previous=='pending' and reminder.status in ('completed','skipped') and (reminder.interval_days or reminder.interval_months):
        anchor=datetime.fromisoformat(reminder.at) if reminder.at else datetime.combine(reminder.due_date,datetime.strptime(reminder.due_time or '09:00','%H:%M').time())
        if reminder.interval_days:
            nxt=anchor+timedelta(days=reminder.interval_days)
        else:
            year,month=divmod(anchor.year*12+anchor.month-1+reminder.interval_months,12)
            nxt=anchor.replace(year=year,month=month+1,day=min(anchor.day,calendar.monthrange(year,month+1)[1]))
        at=nxt.isoformat()
        exists=db.query(models.Reminder).filter(models.Reminder.pet_id==reminder.pet_id,models.Reminder.title==reminder.title,models.Reminder.at==at).first()
        if not exists:
            child=models.Reminder(pet_id=reminder.pet_id,title=reminder.title,reminder_type=reminder.reminder_type,due_date=nxt.date(),due_time=nxt.strftime('%H:%M'),at=at,interval_days=reminder.interval_days,interval_months=reminder.interval_months,food=reminder.food,status='pending')
            db.add(child);db.flush();values['next_id']=child.id
    return values

def install_features(app):
    from auth import get_current_user, verify_password, get_password_hash, create_access_token
    router = APIRouter(prefix='/api/v1')
    replaced = {'/api/v1/auth/register','/api/v1/auth/login','/api/v1/auth/user','/api/v1/auth/profile','/api/v1/auth/session','/api/v1/auth/me','/api/v1/documents/{doc_id}'}
    # Preserve document delete: replaced below with a reversible server operation.
    app.router.routes[:] = [r for r in app.router.routes if getattr(r,'path',None) not in replaced]

    @router.post('/auth/register')
    def register(data: Registration, request: Request, db=Depends(get_db)):
        password_ok(data.password)
        enforce_quota(db, 'register:'+str(request.client.host if request.client else '')+':'+datetime.utcnow().strftime('%Y%m%d%H'), 20)
        if db.query(models.User).filter(models.User.email==data.email).first(): raise HTTPException(400,'Этот адрес уже зарегистрирован. Войдите или восстановите пароль.')
        return issue_code(db, data.email, 'register', payload={'full_name':data.full_name, 'hashed_password':get_password_hash(data.password), 'timezone':data.timezone})

    @router.post('/auth/login')
    def login(data: LoginInput, request: Request, db=Depends(get_db)):
        values = data.model_dump()
        enforce_quota(db, 'login:'+str(request.client.host if request.client else '')+':'+datetime.utcnow().strftime('%Y%m%d%H'), 60)
        try: email=normalize_email('admin@petcare.local' if str(values.get('email','')).strip().lower()==os.getenv('ADMIN_LOGIN','petcare-admin') else str(values.get('email','')))
        except ValueError: raise HTTPException(401,'Неверная почта или пароль')
        account_key = hmac.new(SECRET_KEY.encode(), email.encode(), hashlib.sha256).hexdigest()
        window = str(int(time.time()) // 900)
        enforce_quota(db, 'login-account:'+account_key+':'+window, 10)
        u=db.query(models.User).filter(models.User.email==email).first()
        # Equal-cost password check for unknown users, without account-specific errors.
        from auth import DUMMY_PASSWORD_HASH
        password_valid = verify_password(values['password'], u.hashed_password if u else DUMMY_PASSWORD_HASH)
        if not u or u.disabled or (email in ('demo1@petcare.app','demo2@petcare.app','demo1@petcare.local','demo2@petcare.local')) or not password_valid:
            raise HTTPException(401,'Неверная почта или пароль')
        return {'access_token':create_access_token({'sub':str(u.id)}, device=request.headers.get('user-agent','Браузер')[:200]),'token_type':'bearer','user':user_json(u)}

    @router.get('/auth/session')
    @router.get('/auth/me')
    def me(u=Depends(get_current_user)): return user_json(u)

    @router.post('/auth/codes')
    def code(data: CodeRequest, request: Request, db=Depends(get_db)):
        enforce_quota(db,'codes-ip:'+str(request.client.host if request.client else '')+':'+datetime.utcnow().strftime('%Y%m%d%H'),30)
        if data.purpose != 'password_reset': raise HTTPException(400,'Недопустимая операция')
        u=db.query(models.User).filter(models.User.email==data.email).first()
        if not u: return {'verification_required':True,'challenge_id':secrets.token_urlsafe(24),'expires_in':600,'message':'Если адрес зарегистрирован, письмо с кодом отправлено.'}
        return issue_code(db,u.email,'password_reset',u.id)

    @router.post('/auth/account-codes')
    def account_code(data: CodeRequest, u=Depends(get_current_user), db=Depends(get_db)):
        if data.purpose=='verify_email': return issue_code(db,u.email,'verify_email',u.id)
        if data.purpose not in ('password_change','email_change','delete_account'): raise HTTPException(400,'Недопустимая операция')
        if not verify_password(data.current_password or '',u.hashed_password): raise HTTPException(403,'Неверный текущий пароль')
        email=u.email; payload={}
        if data.purpose=='email_change':
            try: email=normalize_email(data.new_email or '')
            except ValueError: raise HTTPException(422,'Неверная новая почта')
            if db.query(models.User).filter(models.User.email==email).first(): raise HTTPException(409,'Этот адрес уже занят')
            payload={'old_email':u.email}
        return issue_code(db,email,data.purpose,u.id,payload)

    @router.post('/auth/confirm')
    def confirm(data: CodeConfirm, db=Depends(get_db)):
        item=db.get(models.EmailChallenge,data.challenge_id)
        if item and item.purpose in ('password_change','password_reset'): password_ok(data.new_password or '')
        item=consume_code(db,data); payload=json.loads(item.payload)
        u=db.get(models.User,item.user_id) if item.user_id else None
        if item.purpose=='register':
            if db.query(models.User).filter(models.User.email==item.email).first(): raise HTTPException(409,'Адрес уже зарегистрирован')
            u=models.User(email=item.email,email_verified=True,**payload); db.add(u)
        elif not u: raise HTTPException(400,'Аккаунт не найден')
        elif item.purpose in ('password_reset','password_change'):
            if u.email != item.email: raise HTTPException(400,'Запрос устарел. Получите новый код.')
            u.hashed_password=get_password_hash(data.new_password); u.email_verified=True; u.token_version+=1
            db.query(models.LoginSession).filter(models.LoginSession.user_id==u.id).update({'revoked':True})
        elif item.purpose=='email_change':
            if u.email != payload['old_email']: raise HTTPException(400,'Запрос устарел. Получите новый код.')
            if db.query(models.User).filter(models.User.email==item.email,models.User.id!=u.id).first(): raise HTTPException(409,'Адрес уже занят')
            # Notification to the old address is required before completing the change.
            if not payload['old_email'].endswith('.local'): send_email(payload['old_email'],'Почта PetCare изменена','Для вашего аккаунта подтверждена новая электронная почта. Если это были не вы, обратитесь в поддержку.')
            u.email=item.email; u.email_verified=True; u.token_version+=1
            db.query(models.LoginSession).filter(models.LoginSession.user_id==u.id).update({'revoked':True})
        elif item.purpose=='delete_account':
            owned_pets = db.query(models.Pet).filter(models.Pet.owner_id==u.id).all()
            pet_ids = [p.id for p in owned_pets]
            profile_ids = [p.id for p in db.query(models.MatchProfile).filter(or_(
                models.MatchProfile.owner_id==u.id, models.MatchProfile.pet_id.in_(pet_ids)
            )).all()]
            db.query(models.MatchDecision).filter(or_(
                models.MatchDecision.from_pet_id.in_(pet_ids),
                models.MatchDecision.to_pet_id.in_(pet_ids),
                models.MatchDecision.to_profile_id.in_(profile_ids),
            )).delete(synchronize_session=False)
            db.query(models.MatchProfile).filter(models.MatchProfile.id.in_(profile_ids)).delete(synchronize_session=False)
            for p in owned_pets:
                db.delete(p)
            db.query(models.PetMember).filter(models.PetMember.user_id==u.id).delete()
            for cls in (models.LoginSession,models.NotificationPreference,models.PushSubscription,models.EmailChallenge,models.RecoveryAction):
                db.query(cls).filter(cls.user_id==u.id).delete(synchronize_session=False)
            db.delete(u); db.commit(); return {'deleted':True}
        elif item.purpose=='verify_email': u.email_verified=True
        if item.purpose in ('password_reset','password_change','email_change'):
            db.query(models.EmailChallenge).filter(models.EmailChallenge.user_id==u.id).update({'consumed':True})
        db.commit(); db.refresh(u)
        return {'access_token':create_access_token({'sub':str(u.id)}),'token_type':'bearer','user':user_json(u)}

    @router.put('/auth/user')
    @router.patch('/auth/profile')
    def profile(data: ProfileChange,u=Depends(get_current_user),db=Depends(get_db)):
        if data.password or (data.email and data.email.strip().lower()!=u.email): raise HTTPException(400,'Для смены пароля или почты нужен код подтверждения')
        if data.full_name is not None: u.full_name=data.full_name
        if data.timezone:
            try: ZoneInfo(data.timezone)
            except Exception: raise HTTPException(422,'Неверный часовой пояс')
            u.timezone=data.timezone
        db.commit(); return user_json(u)

    @router.get('/auth/sessions')
    def sessions(request:Request,u=Depends(get_current_user),db=Depends(get_db)):
        return [dict(id=s.id,device=s.device,created_at=s.created_at,expires_at=s.expires_at,current=s.id==request.state.session_id) for s in db.query(models.LoginSession).filter(models.LoginSession.user_id==u.id,models.LoginSession.revoked==False,models.LoginSession.expires_at>datetime.utcnow()).all()]

    @router.delete('/auth/sessions/{sid}')
    def revoke(sid:str,u=Depends(get_current_user),db=Depends(get_db)):
        s=db.get(models.LoginSession,sid)
        if not s or s.user_id!=u.id: raise HTTPException(404,'Сессия не найдена')
        s.revoked=True; db.commit(); return {'status':'ok'}

    @router.post('/auth/logout')
    def logout(request:Request,u=Depends(get_current_user),db=Depends(get_db)):
        db.get(models.LoginSession,request.state.session_id).revoked=True; db.commit(); return {'status':'ok'}

    @router.post('/auth/logout-all')
    def logout_all(u=Depends(get_current_user),db=Depends(get_db)):
        u.token_version+=1; db.query(models.LoginSession).filter(models.LoginSession.user_id==u.id).update({'revoked':True}); db.commit(); return {'status':'ok'}

    def owner(db,pet_id,u):
        p=db.get(models.Pet,pet_id)
        if not p or p.owner_id!=u.id: raise HTTPException(403,'Только владелец управляет доступом')
        return p

    @router.get('/pets/{pet_id}/members')
    def members(pet_id:int,u=Depends(get_current_user),db=Depends(get_db)):
        owner(db,pet_id,u)
        return [dict(id=m.id,user_id=m.user_id,email=m.user.email,name=m.user.full_name,role=m.role,expires_at=m.expires_at) for m in db.query(models.PetMember).filter(models.PetMember.pet_id==pet_id).all()]

    @router.post('/pets/{pet_id}/members')
    def grant(pet_id:int,data:MemberChange,u=Depends(get_current_user),db=Depends(get_db)):
        owner(db,pet_id,u)
        try: email=normalize_email(data.email)
        except ValueError: raise HTTPException(422,'Неверная почта')
        target=db.query(models.User).filter(models.User.email==email).first()
        if not target or target.id==u.id: raise HTTPException(400,'Нужен зарегистрированный аккаунт другого участника')
        if data.role not in ('viewer','editor'): raise HTTPException(422,'Неверная роль')
        expiry=data.expires_at
        if expiry and expiry.tzinfo: expiry=expiry.astimezone(ZoneInfo('UTC')).replace(tzinfo=None)
        if expiry and expiry<=datetime.utcnow(): raise HTTPException(422,'Срок должен быть в будущем')
        m=db.query(models.PetMember).filter(models.PetMember.pet_id==pet_id,models.PetMember.user_id==target.id).first()
        if not m: enforce_pet_limit(db,target); m=models.PetMember(pet_id=pet_id,user_id=target.id); db.add(m)
        m.role=data.role; m.expires_at=expiry; db.commit(); return {'status':'ok'}

    @router.delete('/pets/{pet_id}/members/{member_id}')
    def remove_member(pet_id:int,member_id:int,u=Depends(get_current_user),db=Depends(get_db)):
        owner(db,pet_id,u); m=db.get(models.PetMember,member_id)
        if not m or m.pet_id!=pet_id: raise HTTPException(404,'Участник не найден')
        db.delete(m); db.commit(); return {'status':'ok'}

    @router.post('/pets/{pet_id}/rotate-code')
    def rotate(pet_id:int,u=Depends(get_current_user),db=Depends(get_db)):
        p=owner(db,pet_id,u); p.share_code=models.generate_pet_share_code(); db.commit(); return {'share_code':p.share_code}

    @router.get('/notifications/settings')
    def preferences(u=Depends(get_current_user),db=Depends(get_db)):
        p=db.get(models.NotificationPreference,u.id); return json.loads(p.data) if p else PreferenceInput().model_dump()

    @router.put('/notifications/settings')
    def save_preferences(data:PreferenceInput,u=Depends(get_current_user),db=Depends(get_db)):
        p=db.get(models.NotificationPreference,u.id)
        if not p: p=models.NotificationPreference(user_id=u.id); db.add(p)
        p.data=data.model_dump_json(); db.commit(); return data

    @router.get('/notifications/config')
    def push_config(u=Depends(get_current_user)):
        return {'public_key':os.getenv('VAPID_PUBLIC_KEY',''),'configured':bool(os.getenv('VAPID_PRIVATE_KEY')),'email_configured':bool(os.getenv('SMTP_HOST'))}

    @router.post('/notifications/subscribe')
    def subscribe(data:dict,u=Depends(get_current_user),db=Depends(get_db)):
        endpoint = data.get('endpoint', '')
        if not isinstance(endpoint, str) or len(endpoint) > 768:
            raise HTTPException(422, 'Неверная push-подписка')
        parsed=urlparse(endpoint)
        # Fixed provider allowlist prevents outbound requests to arbitrary/internal hosts.
        allowed=parsed.hostname and (parsed.hostname=='fcm.googleapis.com' or parsed.hostname.endswith('.push.services.mozilla.com') or parsed.hostname=='updates.push.services.mozilla.com' or parsed.hostname.endswith('.push.apple.com'))
        keys=data.get('keys',{})
        if parsed.scheme!='https' or parsed.port not in (None,443) or not allowed or not keys.get('auth') or not keys.get('p256dh'): raise HTTPException(422,'Неверная push-подписка')
        sub=db.query(models.PushSubscription).filter(models.PushSubscription.endpoint==endpoint).first()
        if sub and sub.user_id!=u.id: raise HTTPException(409,'Сначала отключите уведомления предыдущего аккаунта на устройстве')
        if not sub: sub=models.PushSubscription(user_id=u.id,endpoint=endpoint); db.add(sub)
        sub.data=json.dumps(data); db.commit(); return {'status':'ok'}

    @router.post('/notifications/unsubscribe')
    def unsubscribe(data:dict,u=Depends(get_current_user),db=Depends(get_db)):
        db.query(models.PushSubscription).filter(models.PushSubscription.user_id==u.id,models.PushSubscription.endpoint==data.get('endpoint')).delete(); db.commit(); return {'status':'ok'}

    @router.delete('/documents/{doc_id}')
    def delete_document(doc_id:int,u=Depends(get_current_user),db=Depends(get_db)):
        from main import get_user_pet_or_404
        doc=db.get(models.Document,doc_id)
        if not doc: raise HTTPException(404,'Документ не найден')
        get_user_pet_or_404(doc.pet_id,u.id,db,write=True)
        values={c.name:getattr(doc,c.name) for c in models.Document.__table__.columns}; values['date']=values['date'].isoformat() if values['date'] else None
        rid=secrets.token_urlsafe(24); db.add(models.RecoveryAction(id=rid,user_id=u.id,pet_id=doc.pet_id,data=json.dumps(values),expires_at=datetime.utcnow()+timedelta(minutes=5))); db.delete(doc); db.commit(); return {'undo_token':rid}

    @router.post('/actions/{token}/undo')
    def undo(token:str,u=Depends(get_current_user),db=Depends(get_db)):
        from main import get_user_pet_or_404
        r=db.get(models.RecoveryAction,token)
        if not r or r.user_id!=u.id or r.consumed or r.expires_at<datetime.utcnow(): raise HTTPException(400,'Время отмены истекло')
        get_user_pet_or_404(r.pet_id,u.id,db,write=True)
        claimed=db.execute(update(models.RecoveryAction).where(models.RecoveryAction.id==r.id,models.RecoveryAction.consumed==False).values(consumed=True))
        if claimed.rowcount!=1: raise HTTPException(400,'Действие уже отменено')
        v=json.loads(r.data)
        if v.get('kind')=='reminder':
            reminder=db.get(models.Reminder,v['id'])
            if not reminder or reminder.pet_id!=r.pet_id: raise HTTPException(404,'Событие не найдено')
            if v.get('next_id'):
                child=db.get(models.Reminder,v['next_id'])
                if child and child.status!='pending': raise HTTPException(409,'Следующее событие уже изменено; автоматическая отмена невозможна')
                if child: db.delete(child)
            reminder.status=v['previous'];reminder.is_completed=reminder.status=='completed';reminder.completed_at=None;reminder.done_by=None
            db.commit();return {'status':'ok'}
        v.pop('id',None)
        from datetime import date
        if v.get('date'): v['date']=date.fromisoformat(v['date'])
        db.add(models.Document(**v)); db.commit(); return {'status':'ok'}

    @router.get('/billing/status')
    def billing(u=Depends(get_current_user)):
        return {'premium':premium(u),'pet_limit':None if premium(u) else 3,'is_admin':u.is_admin,'premium_until':u.premium_until}

    @router.get('/admin/users')
    def users(offset:int=0,search:str='',u=Depends(get_current_user),db=Depends(get_db)):
        if not u.is_admin: raise HTTPException(403,'Доступ только для администратора')
        query=db.query(models.User)
        if search: query=query.filter(or_(models.User.email.contains(search[:100],autoescape=True),models.User.full_name.contains(search[:100],autoescape=True)))
        return {'users':[{**user_json(x),'pet_count':len(x.pets)} for x in query.order_by(models.User.id).offset(max(0,offset)).limit(100).all()],'total':query.count()}

    @router.patch('/admin/users/{user_id}/premium')
    def set_premium(user_id:int,data:dict,u=Depends(get_current_user),db=Depends(get_db)):
        if not u.is_admin: raise HTTPException(403,'Доступ только для администратора')
        target=db.get(models.User,user_id)
        if not target: raise HTTPException(404,'Пользователь не найден')
        enabled=data.get('enabled')
        if not isinstance(enabled,bool): raise HTTPException(422,'Укажите enabled: true/false')
        days=data.get('days')
        if days is not None and (not isinstance(days,int) or days<1 or days>3650): raise HTTPException(422,'Срок: от 1 до 3650 дней')
        target.premium_permanent=enabled and days is None; target.premium_until=datetime.utcnow()+timedelta(days=days) if enabled and days else None
        db.add(models.AdminAudit(actor_id=u.id,target_id=target.id,action='premium:'+str(enabled)+':days='+str(days))); db.commit(); return user_json(target)

    @router.get('/admin/status')
    def admin_status(u=Depends(get_current_user),db=Depends(get_db)):
        if not u.is_admin: raise HTTPException(403,'Доступ только для администратора')
        return {'users':db.query(models.User).count(),'pets':db.query(models.Pet).count(),'documents':db.query(models.Document).count(),'smtp_configured':bool(os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM')),'ocr_configured':(Path(__file__).parent/'static/ocr/vendor/rus.traineddata.gz').is_file(),'push_configured':bool(os.getenv('VAPID_PRIVATE_KEY'))}

    @router.get('/admin/audit')
    def audit(u=Depends(get_current_user),db=Depends(get_db)):
        if not u.is_admin: raise HTTPException(403,'Доступ только для администратора')
        return [dict(actor_id=r.actor_id,target_id=r.target_id,action=r.action,at=r.at) for r in db.query(models.AdminAudit).order_by(models.AdminAudit.id.desc()).limit(100).all()]

    @router.post('/admin/users/{user_id}/revoke-sessions')
    def admin_revoke(user_id:int,u=Depends(get_current_user),db=Depends(get_db)):
        if not u.is_admin: raise HTTPException(403,'Доступ только для администратора')
        target=db.get(models.User,user_id)
        if not target: raise HTTPException(404,'Пользователь не найден')
        target.token_version+=1; db.query(models.LoginSession).filter(models.LoginSession.user_id==user_id).update({'revoked':True})
        db.add(models.AdminAudit(actor_id=u.id,target_id=user_id,action='revoke_sessions')); db.commit(); return {'status':'ok'}

    @router.patch('/admin/users/{user_id}/blocked')
    def block(user_id:int,data:dict,u=Depends(get_current_user),db=Depends(get_db)):
        if not u.is_admin: raise HTTPException(403,'Доступ только для администратора')
        target=db.get(models.User,user_id)
        if not target: raise HTTPException(404,'Пользователь не найден')
        if target.is_admin: raise HTTPException(400,'Нельзя блокировать администратора')
        if not isinstance(data.get('blocked'),bool): raise HTTPException(422,'Укажите blocked')
        target.disabled=data['blocked']; target.token_version+=1
        db.add(models.AdminAudit(actor_id=u.id,target_id=user_id,action='blocked:'+str(target.disabled))); db.commit(); return user_json(target)

    @router.get('/account/export')
    def export(u=Depends(get_current_user),db=Depends(get_db)):
        from fastapi.encoders import jsonable_encoder
        pets=db.query(models.Pet).filter(models.Pet.owner_id==u.id).all()
        result={'account':user_json(u),'pets':[]}
        for p in pets:
            v={c.name:getattr(p,c.name) for c in models.Pet.__table__.columns}
            for relation in ('health_records','nutrition_logs','reminders','meal_plans','feeding_logs','weights','prescriptions','documents','shopping_items','activities'):
                v[relation]=[{c.name:getattr(row,c.name) for c in row.__table__.columns} for row in getattr(p,relation)]
            result['pets'].append(v)
        return JSONResponse(jsonable_encoder(result),headers={'Content-Disposition':'attachment; filename="petcare-export.json"'})

    app.include_router(router)
    static=Path(__file__).parent/'static'
    @app.get('/manifest.webmanifest',include_in_schema=False)
    def manifest(): return FileResponse(static/'manifest.webmanifest',media_type='application/manifest+json')
    @app.get('/sw.js',include_in_schema=False)
    def service_worker(): return FileResponse(static/'sw.js',media_type='text/javascript',headers={'Cache-Control':'no-cache','Service-Worker-Allowed':'/'})
    from fastapi.staticfiles import StaticFiles
    app.mount('/static',StaticFiles(directory=static),name='static')
