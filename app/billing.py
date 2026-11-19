"""One-time Premium payments and verified YooKassa notifications."""

import calendar
from datetime import datetime, timedelta
from html import escape
import os
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
import httpx
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from auth import get_current_user
from database import get_db
from features import enforce_quota
from models import PremiumOrder, User


PRICES = {1: 99, 3: 259, 6: 499, 12: 999}
PROVIDER = 'https://api.yookassa.ru/v3/payments'
PROVIDER_HOSTS = {'yookassa.ru', 'yoomoney.ru'}


class Checkout(BaseModel):
    months: Literal[1, 3, 6, 12]
    order_id: UUID


class Notification(BaseModel):
    event: str
    object: dict


def seller():
    return {key: os.getenv('PETCARE_SELLER_' + key.upper(), '').strip() for key in
            ('name', 'inn', 'email', 'phone', 'address', 'terms')}


def shop():
    return os.getenv('YOOKASSA_SHOP_ID', ''), os.getenv('YOOKASSA_SECRET_KEY', '')


def enabled():
    return os.getenv('YOOKASSA_ENABLED') == 'true' and all(shop()) and all(seller())


def amount(rubles):
    return {'value': f'{rubles}.00', 'currency': 'RUB'}


def provider_request(method, payment_id=None, **options):
    url = PROVIDER if payment_id is None else f'{PROVIDER}/{UUID(str(payment_id))}'
    try:
        result = httpx.request(method, url, auth=shop(), timeout=8, **options)
        result.raise_for_status()
        return result.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'ЮKassa временно недоступна. Повторите попытку.') from None


def check_payment(order, result):
    expected = {'order_id': order.id}
    received = result.get('amount') or {}
    if (result.get('metadata') != expected or received != amount(order.price)
            or result.get('test') != (os.getenv('YOOKASSA_TEST') == 'true')
            or order.payment_id and order.payment_id != result.get('id')):
        raise HTTPException(502, 'Данные платежа не совпали с заказом.')


def add_months(start, months):
    year, month = divmod(start.year * 12 + start.month - 1 + months, 12)
    day = min(start.day, calendar.monthrange(year, month + 1)[1])
    return start.replace(year=year, month=month + 1, day=day)


def apply_payment(db, order, result):
    check_payment(order, result)
    if result.get('status') != 'succeeded' or result.get('paid') is not True:
        return False
    claimed = db.execute(update(PremiumOrder).where(
        PremiumOrder.id == order.id, PremiumOrder.granted_at.is_(None),
    ).values(granted_at=datetime.utcnow(), payment_id=str(UUID(result['id']))))
    if claimed.rowcount != 1:
        return True
    user = db.scalar(select(User).where(User.id == order.user_id)
                     .with_for_update().execution_options(populate_existing=True))
    if user and not user.premium_permanent:
        now = datetime.utcnow()
        start = max(now, user.premium_until) if user.premium_until else now
        user.premium_until = add_months(start, order.months)
    db.commit()
    return True


def install_billing(app):
    router = APIRouter(prefix='/api/v1/billing')

    @router.get('/plans')
    def plans():
        return {'enabled': enabled(), 'test': os.getenv('YOOKASSA_TEST') == 'true', 'prices': PRICES}

    @router.post('/checkout')
    def checkout(data: Checkout, user=Depends(get_current_user), db=Depends(get_db)):
        if not enabled():
            raise HTTPException(503, 'Оплата Premium пока недоступна.')
        if user.premium_permanent:
            raise HTTPException(409, 'У вас уже есть бессрочный Premium.')
        order_id = str(data.order_id)
        order = db.get(PremiumOrder, order_id)
        if order is None:
            enforce_quota(db, f'billing:{user.id}:{datetime.utcnow():%Y%m%d%H}', 12)
            order = PremiumOrder(id=order_id, user_id=user.id, months=data.months, price=PRICES[data.months])
            db.add(order)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
            order = db.get(PremiumOrder, order_id)
            if order is None:
                raise HTTPException(409, 'Не удалось сохранить заказ. Повторите попытку.')
        if order.user_id != user.id or order.months != data.months:
            raise HTTPException(404, 'Заказ не найден.')
        if order.payment_id:
            result = provider_request('GET', order.payment_id)
        else:
            if datetime.utcnow() - order.created_at > timedelta(hours=23):
                raise HTTPException(409, 'Срок создания платежа истёк. Откройте выбор тарифа заново.')
            test = os.getenv('YOOKASSA_TEST') == 'true'
            result = provider_request('POST', headers={'Idempotence-Key': order.id}, json={
                'amount': amount(order.price), 'capture': True,
                'description': f'PetCare Premium · {order.months} мес.',
                'confirmation': {'type': 'redirect', 'return_url':
                    f'https://petcarehome.ru/?payment={order.id}#/profile'},
                'metadata': {'order_id': order.id},
                **({'payment_method_data': {'type': 'bank_card'}} if test else {}),
            })
            check_payment(order, result)
            order.payment_id = str(UUID(result['id']))
            db.commit()
        if apply_payment(db, order, result):
            return {'status': 'succeeded'}
        if result.get('status') == 'canceled':
            return {'status': 'canceled'}
        url = (result.get('confirmation') or {}).get('confirmation_url', '')
        redirect = urlsplit(url)
        if redirect.scheme != 'https' or redirect.username or redirect.password or not any(
            redirect.hostname == host or (redirect.hostname or '').endswith('.' + host) for host in PROVIDER_HOSTS
        ):
            raise HTTPException(502, 'ЮKassa не вернула ссылку на оплату.')
        return {'status': 'pending', 'url': url}

    @router.get('/orders/{order_id}')
    def order_status(order_id: UUID, user=Depends(get_current_user), db=Depends(get_db)):
        order = db.get(PremiumOrder, str(order_id))
        if order is None or order.user_id != user.id:
            raise HTTPException(404, 'Заказ не найден.')
        if order.granted_at:
            return {'status': 'succeeded'}
        if not order.payment_id or not all(shop()):
            return {'status': 'pending'}
        result = provider_request('GET', order.payment_id)
        if apply_payment(db, order, result):
            return {'status': 'succeeded'}
        return {'status': 'canceled' if result.get('status') == 'canceled' else 'pending'}

    @router.post('/yookassa/webhook')
    def webhook(notice: Notification, db=Depends(get_db)):
        if notice.event != 'payment.succeeded' or not all(shop()):
            return {'status': 'ignored'}
        try:
            payment_id = str(UUID(notice.object['id']))
        except (KeyError, ValueError, TypeError, AttributeError):
            return {'status': 'ignored'}
        order = db.scalar(select(PremiumOrder).where(PremiumOrder.payment_id == payment_id))
        if order is None:
            try:
                order_id = str(UUID(notice.object['metadata']['order_id']))
            except (KeyError, ValueError, TypeError, AttributeError):
                return {'status': 'ignored'}
            order = db.get(PremiumOrder, order_id)
        if order and not order.granted_at:
            result = provider_request('GET', payment_id)
            if result.get('id') != payment_id:
                raise HTTPException(502, 'Не удалось подтвердить платёж.')
            apply_payment(db, order, result)
        return {'status': 'ok'}

    @app.get('/premium', response_class=HTMLResponse, include_in_schema=False)
    def premium_page(lang: Literal['ru', 'en'] = 'ru'):
        details = seller()
        if lang == 'en':
            rows = ''.join(f'<li>{months} mo. — {price} ₽</li>' for months, price in PRICES.items())
            return (
                '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" '
                'content="width=device-width, initial-scale=1"><title>PetCare Premium</title>'
                '<main><h1>PetCare Premium</h1><p>Upgrade your account to add more than three pets.</p>'
                f'<h2>Pricing</h2><ul>{rows}</ul><p>Pay once for the selected period. Premium starts when payment '
                'is confirmed. Your subscription does not renew automatically.</p>'
                '<p><a href="/premium">Official Premium terms (Russian)</a></p>'
                '<p><a href="/#/profile">Open PetCare</a></p></main></html>'
            )
        rows = ''.join(f'<li>{months} мес. — {price} ₽</li>' for months, price in PRICES.items())
        text = ''
        if all(details.values()):
            contacts = ''.join(f'<li>{escape(value)}</li>' for key, value in details.items()
                               if key in ('email', 'phone', 'address'))
            terms = ''.join(f'<p>{escape(paragraph)}</p>' for paragraph in details['terms'].splitlines() if paragraph.strip())
            text = (f'<h2>Исполнитель и контакты</h2><p>{escape(details["name"])} · ИНН {escape(details["inn"])}</p>'
                    f'<ul>{contacts}</ul><h2>Условия доступа</h2>{terms}')
        return (
            '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" '
            'content="width=device-width, initial-scale=1"><title>PetCare Premium</title>'
            '<main><h1>PetCare Premium</h1><p>Расширенный доступ для аккаунта PetCare. '
            'Позволяет добавить больше трёх питомцев.</p><h2>Цены</h2>'
            f'<ul>{rows}</ul><p>Разовая оплата за выбранный период. После подтверждения '
            'платежа Premium включается в вашем аккаунте. Автопродления нет.</p>'
            f'{text}<p><a href="/#/profile">Открыть PetCare</a></p></main></html>'
        )

    app.include_router(router)
