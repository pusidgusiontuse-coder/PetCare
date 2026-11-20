import { formatLocale, language, uiText } from '../../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createApiClient } from '../../lib/api';
import './premium.css';

import { periods, type Prices } from './periods';

const priceFormat = new Intl.NumberFormat(formatLocale);

type Payment = { status: 'pending' | 'succeeded' | 'canceled'; url?: string };
type Plans = { enabled: boolean; test: boolean; prices: Prices };
const api = createApiClient({
  getToken: () => localStorage.getItem('petcare_jwt') ?? '',
  onUnauthorized: () => {},
  onMutationError: () => {},
});

export function PremiumPlan() {
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef<{ months: number; price: number; id: string } | null>(null);
  const [months, setMonths] = useState<keyof Prices>(1);
  const [plans, setPlans] = useState<Plans | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingOrder, setPendingOrder] = useState('');
  const selected = periods.find(period => period.months === months) ?? periods[0];

  const show = useCallback(async () => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    setPlans(null);
    setMessage('');
    try { setPlans(await api<Plans>('/billing/plans', { cache: 'no-store' })); }
    catch { setMessage(uiText("Не удалось загрузить настройки оплаты.")); }
  }, []);

  const updatePayment = useCallback((result: Payment | null, id: string) => {
    if (result?.status === 'succeeded') {
      attempt.current = null;
      setPendingOrder('');
      setMessage(uiText("Оплата подтверждена. Premium активирован."));
      window.dispatchEvent(new Event('petcare-premium-updated'));
    } else if (result?.status === 'canceled') {
      attempt.current = null;
      setPendingOrder('');
      setMessage(uiText("Платёж отменён. Можно попробовать ещё раз."));
    } else {
      setPendingOrder(id);
      setMessage(uiText("Ожидаем подтверждение оплаты."));
    }
  }, []);

  const check = useCallback(async (id: string) => {
    setBusy(true);
    try { updatePayment(await api<Payment>('/billing/orders/' + encodeURIComponent(id)), id); }
    catch (error) { setMessage(error instanceof Error ? error.message : uiText("Не удалось проверить оплату.")); }
    finally { setBusy(false); }
  }, [updatePayment]);

  useEffect(() => {
    const url = new URL(location.href);
    const orderId = url.searchParams.get('payment');
    if (orderId && /^[0-9a-f-]{36}$/i.test(orderId)) {
      url.searchParams.delete('payment');
      history.replaceState(history.state, '', url);
      void show();
      setPendingOrder(orderId);
      void check(orderId);
    }
  }, [check, show]);

  async function pay() {
    if (!plans?.enabled || busy) return;
    const price = plans.prices[months];
    if (!attempt.current || attempt.current.months !== months || attempt.current.price !== price) {
      attempt.current = { months, price, id: crypto.randomUUID() };
    }
    const orderId = attempt.current.id;
    setMessage('');
    setBusy(true);
    try {
      const result = await api<Payment>('/billing/checkout', {
        method: 'POST', body: JSON.stringify({ months, order_id: orderId, quoted_price: price }),
      });
      if (result?.status === 'pending' && result.url) location.assign(result.url);
      else updatePayment(result, orderId);
    } catch (error) {
      if (error instanceof ApiError && error.reason === 'premium_price_changed') {
        attempt.current = null;
        await show();
      }
      setMessage(error instanceof Error ? error.message : uiText("Не удалось открыть оплату."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-premium">
      <button className="premium-banner" type="button" onClick={() => void show()} aria-haspopup="dialog">
        <span><strong>PetCare Premium</strong><span id="premium-banner-action">{uiText("Переключиться на премиум-версию")}</span></span>
        <span className="premium-banner-arrow" aria-hidden="true">→</span>
      </button>
      <p className="premium-current" id="plan-status" />

      <dialog className="premium-dialog" ref={dialog} aria-labelledby="premium-title">
        <form method="dialog">
          <button type="submit" className="modal-close" aria-label={uiText("Закрыть выбор периода")} />
        </form>
        <h2 id="premium-title">PetCare Premium</h2>
        <p className="premium-intro">{uiText("Добавляйте больше трёх питомцев.")}</p>
        {plans && <><fieldset className="premium-periods" disabled={busy}>
          <legend>{uiText("Выберите период")}</legend>
          {periods.map(period => {
            const price = plans.prices[period.months];
            const discount = Math.round(100 * (1 - price / (plans.prices[1] * period.months)));
            return (
              <label className="premium-option" key={period.months}>
                <input type="radio" name="premium-months" value={period.months} checked={months === period.months}
                  onChange={() => setMonths(period.months)} />
                <span className="premium-option-body">
                  <span>{period.label}</span>
                  <strong>{priceFormat.format(price)} ₽</strong>
                  {discount > 0 && <small>{uiText("Скидка")+" "}{discount}%</small>}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="premium-total" aria-live="polite">
          <span>{uiText("За")+" "}{selected.label}</span><strong>{priceFormat.format(plans.prices[months])} ₽</strong>
        </div></>}
        {!plans && message && <button className="btn premium-pay" type="button" onClick={() => void show()}>{uiText("Повторить")}</button>}
        <button className="btn primary premium-pay" type="button" disabled={!plans?.enabled || busy || Boolean(pendingOrder)}
          aria-describedby="premium-payment-status" onClick={() => void pay()}>
          {plans?.test ? uiText("Открыть тестовую оплату") : uiText("Перейти к оплате")}
        </button>
        {pendingOrder && <button className="btn premium-pay" type="button" disabled={busy}
          onClick={() => void check(pendingOrder)}>{uiText("Проверить оплату")}</button>}
        <p className="premium-payment-status" role="status" id="premium-payment-status">
          {message || (!plans ? uiText("Загружаем…") : plans.enabled ? uiText("Оплата разовая. Автопродления нет.") : uiText("Оплата через ЮKassa пока недоступна."))}
        </p>
        <p className="premium-payment-status"><a href={language === 'en' ? '/premium?lang=en' : '/premium'} target="_blank" rel="noopener">{uiText("Условия Premium")}</a></p>
      </dialog>
    </div>
  );
}
