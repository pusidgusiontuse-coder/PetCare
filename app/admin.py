"""Administrator routes. Every private operation checks the actor on the server."""
from datetime import datetime, timedelta
from ipaddress import ip_address
import os
from pathlib import Path
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictBool
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from auth import get_current_user, get_password_hash, verify_password
from database import get_db
from features import Registration, delete_account_data, enforce_quota, password_ok, public_email, user_json
from login_guard import IP_LIMIT, IP_PAUSE, account_key, insert_if_absent, support_contact
import models
from premium_pricing import PremiumPrices, premium_prices, set_premium_prices
from server_metrics import server_metrics


def require_admin(user=Depends(get_current_user)):
    if not user.is_admin:
        raise HTTPException(403, 'Доступ только для администратора')
    return user


def find_user(db, user_id, *, lock=False):
    user = db.get(models.User, user_id, with_for_update=lock)
    if not user:
        raise HTTPException(404, 'Пользователь не найден')
    return user


def audit(db, actor, target_id, action):
    db.add(models.AdminAudit(actor_id=actor.id, target_id=target_id, action=action))


def revoke_sessions(db, target):
    target.token_version += 1
    db.query(models.LoginSession).filter_by(user_id=target.id).update({'revoked': True})


def invalidate_access(db, target):
    revoke_sessions(db, target)
    db.query(models.EmailChallenge).filter_by(user_id=target.id, consumed=False).update({'consumed': True})


def managed_user(user):
    return {**user_json(user), 'admin_login': user.admin_login}


def reauthenticated_target(db, actor, user_id, current_password):
    enforce_quota(db, f'admin-reauth:{actor.id}:{datetime.utcnow():%Y%m%d%H}', 60)
    # Acquire both rows in the same order when two admins operate on each other.
    users = {row.id: row for row in db.scalars(
        select(models.User).where(models.User.id.in_({actor.id, user_id}))
        .order_by(models.User.id).with_for_update().execution_options(populate_existing=True)
    )}
    actor = users.get(actor.id)
    if not actor or not actor.is_admin or actor.disabled:
        raise HTTPException(403, 'Доступ только для администратора')
    if not verify_password(current_password, actor.hashed_password):
        raise HTTPException(403, 'Неверный пароль администратора')
    if user_id not in users:
        raise HTTPException(404, 'Пользователь не найден')
    return users[user_id]


def canonical_timezone(value):
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise HTTPException(422, 'Неверный часовой пояс') from None
    return value


class Reauthenticate(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)


class PasswordChange(Reauthenticate):
    new_password: str = Field(min_length=8, max_length=72)


class AccountEdit(Reauthenticate):
    full_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=1, max_length=254)
    timezone: str = Field(min_length=1, max_length=50)
    admin_login: str | None = Field(default=None, max_length=64)


class AccountDelete(Reauthenticate):
    confirmation_email: str = Field(min_length=1, max_length=254)


class RoleChange(BaseModel):
    is_admin: StrictBool


class PremiumChange(BaseModel):
    enabled: StrictBool
    days: int | None = Field(default=None, strict=True, ge=1, le=3650)


class BlockChange(BaseModel):
    blocked: StrictBool


class SupportChange(BaseModel):
    support_contact: str = Field(max_length=500)


def install_admin(app):
    router = APIRouter(prefix='/api/v1/admin', tags=['Администрирование'])

    @router.get('/users')
    def users(offset: int = Query(0, ge=0), search: str = Query('', max_length=100),
              actor=Depends(require_admin), db=Depends(get_db)):
        query = db.query(models.User)
        if search:
            query = query.filter(or_(models.User.email.icontains(search, autoescape=True),
                                     models.User.full_name.icontains(search, autoescape=True),
                                     models.User.admin_login.icontains(search, autoescape=True)))
        counts = select(func.count()).where(models.Pet.owner_id == models.User.id).scalar_subquery()
        page = query.add_columns(counts.label('pet_count')).order_by(models.User.id).offset(offset).limit(50)
        return {'users': [{**managed_user(user), 'pet_count': count} for user, count in page], 'total': query.count()}

    @router.post('/users', status_code=201)
    def create_user(data: Registration, actor=Depends(require_admin), db=Depends(get_db)):
        full_name = data.full_name.strip()
        if not full_name:
            raise HTTPException(422, 'Укажите имя пользователя')
        target = models.User(full_name=full_name, email=data.email,
                             timezone=canonical_timezone(data.timezone), email_verified=False,
                             hashed_password=get_password_hash(password_ok(data.password)))
        db.add(target)
        try:
            db.flush()
            audit(db, actor, target.id, 'create_without_email_code')
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'Этот адрес уже зарегистрирован') from None
        return user_json(target)

    @router.patch('/users/{user_id}')
    def edit_user(user_id: int, data: AccountEdit, actor=Depends(require_admin), db=Depends(get_db)):
        target = reauthenticated_target(db, actor, user_id, data.current_password)
        name = data.full_name.strip()
        if not name:
            raise HTTPException(422, 'Укажите имя пользователя')
        email = data.email.strip().lower()
        if email != target.email:
            try:
                email = public_email(email)
            except ValueError as error:
                raise HTTPException(422, str(error)) from None
        login = target.admin_login
        if data.admin_login is not None:
            login = data.admin_login.strip().lower() or None
        if login != target.admin_login and (not target.is_admin or login and not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,63}', login)):
            raise HTTPException(422, 'Логин администратора должен содержать 2–64 латинских буквы, цифры, точки, дефисы или подчёркивания')
        if target.email == 'admin@petcare.local' and email != target.email and not login:
            login = os.getenv('ADMIN_LOGIN', 'petcare-admin').strip().lower()
        access_changed = email != target.email or login != target.admin_login
        if email != target.email:
            target.email_verified = False
        target.full_name, target.email, target.admin_login = name, email, login
        target.timezone = canonical_timezone(data.timezone)
        if access_changed:
            invalidate_access(db, target)
        audit(db, actor, user_id, 'edit_account')
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'Эта электронная почта или логин уже используются') from None
        return {**managed_user(target), 'sessions_revoked': access_changed}

    @router.patch('/users/{user_id}/password')
    def change_password(user_id: int, data: PasswordChange, actor=Depends(require_admin), db=Depends(get_db)):
        target = reauthenticated_target(db, actor, user_id, data.current_password)
        target.hashed_password = get_password_hash(password_ok(data.new_password))
        invalidate_access(db, target)
        audit(db, actor, user_id, 'change_password')
        db.commit()
        return {'status': 'ok'}

    @router.post('/users/{user_id}/clear-login-lock')
    def clear_login_lock(user_id: int, actor=Depends(require_admin), db=Depends(get_db)):
        find_user(db, user_id)
        db.query(models.LoginGuard).filter_by(key=account_key(f'user:{user_id}')).delete()
        audit(db, actor, user_id, 'clear_login_lock')
        db.commit()
        return {'status': 'ok'}

    @router.post('/users/{user_id}/delete')
    def delete_user(user_id: int, data: AccountDelete, actor=Depends(require_admin), db=Depends(get_db)):
        target = reauthenticated_target(db, actor, user_id, data.current_password)
        if target.is_admin:
            raise HTTPException(400, 'Перед удалением снимите роль администратора')
        if data.confirmation_email.strip().lower() != target.email:
            raise HTTPException(422, 'Для подтверждения введите почту удаляемого аккаунта')
        delete_account_data(db, target)
        audit(db, actor, user_id, 'delete_account')
        db.commit()
        return {'deleted': True}

    @router.patch('/users/{user_id}/role')
    def set_role(user_id: int, data: RoleChange, actor=Depends(require_admin), db=Depends(get_db)):
        if user_id == actor.id:
            raise HTTPException(400, 'Свою роль менять нельзя')
        # Serialize role changes, including simultaneous attempts to demote each other.
        insert_if_absent(db, models.SiteSetting.__table__, 'admin_roles_lock', value='')
        db.scalar(select(models.SiteSetting).where(models.SiteSetting.key == 'admin_roles_lock').with_for_update())
        db.refresh(actor, with_for_update=True)
        require_admin(actor)
        target = find_user(db, user_id, lock=True)
        if target.disabled and data.is_admin:
            raise HTTPException(400, 'Сначала разблокируйте пользователя')
        if target.is_admin != data.is_admin:
            target.is_admin = data.is_admin
            revoke_sessions(db, target)
            audit(db, actor, user_id, 'role:admin' if data.is_admin else 'role:user')
        db.commit()
        return user_json(target)

    @router.patch('/users/{user_id}/premium')
    def set_premium(user_id: int, data: PremiumChange, actor=Depends(require_admin), db=Depends(get_db)):
        target = find_user(db, user_id)
        target.premium_permanent = data.enabled and data.days is None
        target.premium_until = datetime.utcnow() + timedelta(days=data.days) if data.enabled and data.days else None
        audit(db, actor, user_id, f'premium:{data.enabled}:days={data.days}')
        db.commit()
        return user_json(target)

    @router.patch('/users/{user_id}/blocked')
    def block(user_id: int, data: BlockChange, actor=Depends(require_admin), db=Depends(get_db)):
        target = find_user(db, user_id, lock=True)
        if target.is_admin:
            raise HTTPException(400, 'Сначала снимите роль администратора')
        target.disabled = data.blocked
        revoke_sessions(db, target)
        audit(db, actor, user_id, f'blocked:{target.disabled}')
        db.commit()
        return user_json(target)

    @router.get('/users/{user_id}/sessions')
    def login_history(user_id: int, offset: int = Query(0, ge=0),
                      actor=Depends(require_admin), db=Depends(get_db)):
        find_user(db, user_id)
        now = datetime.utcnow()
        query = db.query(models.LoginSession).filter_by(user_id=user_id)
        sessions = query.order_by(models.LoginSession.created_at.desc(), models.LoginSession.id).offset(offset).limit(50)
        return {'sessions': [
            {'ip_address': entry.ip_address, 'device': entry.device, 'created_at': entry.created_at,
             'expires_at': entry.expires_at, 'active': not entry.revoked and entry.expires_at > now}
            for entry in sessions
        ], 'total': query.count()}

    @router.post('/users/{user_id}/revoke-sessions')
    def revoke_all(user_id: int, actor=Depends(require_admin), db=Depends(get_db)):
        target = find_user(db, user_id)
        revoke_sessions(db, target)
        audit(db, actor, user_id, 'revoke_sessions')
        db.commit()
        return {'status': 'ok'}

    @router.get('/premium-prices')
    def get_premium_prices(actor=Depends(require_admin), db=Depends(get_db)):
        return {'prices': premium_prices(db)}

    @router.put('/premium-prices')
    def update_premium_prices(data: PremiumPrices, actor=Depends(require_admin), db=Depends(get_db)):
        set_premium_prices(db, data)
        audit(db, actor, actor.id, 'update_premium_prices')
        db.commit()
        return data

    @router.get('/settings')
    def get_settings(actor=Depends(require_admin), db=Depends(get_db)):
        return {'support_contact': support_contact(db)}

    @router.patch('/settings')
    def update_settings(data: SupportChange, actor=Depends(require_admin), db=Depends(get_db)):
        value = data.support_contact.strip()
        insert_if_absent(db, models.SiteSetting.__table__, 'support_contact', value='')
        setting = db.get(models.SiteSetting, 'support_contact')
        setting.value = value
        audit(db, actor, actor.id, 'update_support_contact')
        db.commit()
        return {'support_contact': value}

    @router.get('/blocked-ips')
    def blocked_ips(offset: int = Query(0, ge=0), actor=Depends(require_admin), db=Depends(get_db)):
        query = db.query(models.LoginGuard).filter(models.LoginGuard.key.startswith('ip:'),
                                                   models.LoginGuard.failures >= IP_LIMIT,
                                                   models.LoginGuard.blocked_until > datetime.utcnow() - IP_PAUSE)
        rows = query.order_by(models.LoginGuard.blocked_until.desc(), models.LoginGuard.key).offset(offset).limit(50)
        return {'ips': [{'ip_address': row.key[3:], 'blocked_at': row.blocked_until,
                         'failures': row.failures} for row in rows], 'total': query.count()}

    @router.delete('/blocked-ips/{address}')
    def unblock_ip(address: str, actor=Depends(require_admin), db=Depends(get_db)):
        try:
            address = ip_address(address).compressed
        except ValueError:
            raise HTTPException(422, 'Некорректный IP-адрес') from None
        key = 'ip:' + address
        row = db.scalar(select(models.LoginGuard).where(models.LoginGuard.key == key).with_for_update())
        if not row or row.failures < IP_LIMIT:
            raise HTTPException(404, 'Этот IP не заблокирован')
        db.delete(row)
        audit(db, actor, actor.id, 'unblock_ip:' + address)
        db.commit()
        return {'status': 'ok'}

    @router.get('/status')
    def status(actor=Depends(require_admin), db=Depends(get_db)):
        return {
            'users': db.query(models.User).count(),
            'pets': db.query(models.Pet).count(),
            'documents': db.query(models.Document).count(),
            'active_sessions': db.query(models.LoginSession).filter(
                models.LoginSession.revoked.is_(False), models.LoginSession.expires_at > datetime.utcnow(),
            ).count(),
            **server_metrics(),
            'smtp_configured': bool(os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM')),
            'ocr_configured': (Path(__file__).parent / 'static/ocr/vendor/rus.traineddata.gz').is_file(),
            'push_configured': bool(os.getenv('VAPID_PRIVATE_KEY')),
        }

    @router.get('/audit')
    def audit_history(actor=Depends(require_admin), db=Depends(get_db)):
        rows = db.query(models.AdminAudit).order_by(models.AdminAudit.id.desc()).limit(100)
        return [{'actor_id': row.actor_id, 'target_id': row.target_id,
                 'action': row.action, 'at': row.at} for row in rows]

    app.include_router(router)
