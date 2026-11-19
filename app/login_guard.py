"""Persistent login limits based on the verified peer and normalized account."""
from datetime import datetime, timedelta
import hashlib
import hmac
from ipaddress import IPv6Address, ip_address
from math import ceil

from fastapi import HTTPException
from sqlalchemy import select

import models
from settings import SECRET_KEY

ACCOUNT_LIMIT = 5
ACCOUNT_PAUSE_SECONDS = 30
IP_LIMIT = 50


def peer_ip(request):
    try:
        address = ip_address(request.client.host) if request.client else None
    except ValueError:
        return None
    if isinstance(address, IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.compressed if address is not None else None


def account_key(identity):
    digest = hmac.new(SECRET_KEY.encode(), identity.encode(errors='replace'), hashlib.sha256)
    return 'account:' + digest.hexdigest()


def insert_if_absent(db, table, key, **values):
    dialect = db.get_bind().dialect.name
    if dialect == 'mysql':
        from sqlalchemy.dialects.mysql import insert
        stmt = insert(table).values(key=key, **values)
        stmt = stmt.on_duplicate_key_update(key=table.c.key)
    else:
        if dialect == 'sqlite':
            from sqlalchemy.dialects.sqlite import insert
        else:
            from sqlalchemy.dialects.postgresql import insert
        stmt = insert(table).values(key=key, **values).on_conflict_do_nothing(index_elements=[table.c.key])
    db.execute(stmt)


def support_contact(db):
    setting = db.get(models.SiteSetting, 'support_contact')
    return setting.value if setting else ''


def _check(db, ip_state, account, now):
    if ip_state and ip_state.failures >= IP_LIMIT:
        raise HTTPException(403, detail={
            'message': 'Вход с этого IP заблокирован. Обратитесь в поддержку.',
            'reason': 'ip_blocked', 'support_contact': support_contact(db),
        })
    if account and account.blocked_until and account.blocked_until > now:
        seconds = ceil((account.blocked_until - now).total_seconds())
        raise HTTPException(429, headers={'Retry-After': str(seconds)}, detail={
            'message': f'Слишком много неверных паролей. Повторите через {seconds} сек.',
            'reason': 'account_cooldown', 'retry_after': seconds,
            'support_contact': support_contact(db),
        })


def check_ip(db, ip):
    state = db.get(models.LoginGuard, 'ip:' + ip) if ip else None
    _check(db, state, None, datetime.utcnow())


def precheck(db, ip, key):
    check_ip(db, ip)
    _check(db, None, db.get(models.LoginGuard, key), datetime.utcnow())


def finish_attempt(db, ip, key, *, failed, reset):
    """Serialize counters for a given IP and account, in that lock order."""
    if not failed and not reset:
        return
    # End the read transaction before obtaining writable row locks.
    db.rollback()
    table = models.LoginGuard.__table__
    ip_state = None
    if ip:
        ip_key = 'ip:' + ip
        insert_if_absent(db, table, ip_key, failures=0)
        ip_state = db.scalar(select(models.LoginGuard).where(models.LoginGuard.key == ip_key).with_for_update())
    insert_if_absent(db, table, key, failures=0)
    account = db.scalar(select(models.LoginGuard).where(models.LoginGuard.key == key).with_for_update())
    now = datetime.utcnow()
    _check(db, ip_state, account, now)
    if account.blocked_until:
        account.blocked_until = None
        account.failures = 0
    if reset:
        account.failures = 0
    else:
        account.failures += 1
        if account.failures >= ACCOUNT_LIMIT:
            account.blocked_until = now + timedelta(seconds=ACCOUNT_PAUSE_SECONDS)
        if ip_state:
            ip_state.failures += 1
            if ip_state.failures >= IP_LIMIT:
                ip_state.blocked_until = now  # Timestamp of a persistent IP block.
    blocked = None
    try:
        _check(db, ip_state, account, now)
    except HTTPException as error:
        blocked = error
    db.commit()
    if blocked:
        raise blocked
