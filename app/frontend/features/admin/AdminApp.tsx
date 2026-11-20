import { formatLocale, uiText } from '../../i18n';
import { LanguagePicker } from '../../i18n/LanguagePicker';
import { BrandName } from '../../components/Brand';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, createApiClient } from '../../lib/api';
import { appendSample, ServerMetrics, type Stats } from './ServerMetrics';
import { maxPremiumPrice, periods, type Prices } from '../billing/periods';
import './admin.css';

const PAGE = 50;
const REFRESH_MS = 10_000;
const MAX_PREMIUM_DAYS = 3650; // Matches the administration API.
const ADMIN_SESSION = 'petcare_admin_session';
const STANDARD_SESSION = 'petcare_jwt';

type User = {
  id: number; full_name: string; email: string; email_verified: boolean;
  is_admin: boolean; disabled: boolean; premium: boolean; premium_until: string | null;
};
type UserRow = User & { pet_count: number; timezone: string; admin_login: string | null };
type Session = { ip_address: string | null; device: string; created_at: string; expires_at: string; active: boolean };
type Contact = { support_contact: string };
type Login = { access_token: string; user: User };
type History = { sessions: Session[]; total: number };
type Audit = { actor_id: number; target_id: number; action: string; at: string };
type Block = { ip_address: string; blocked_at: string; failures: number };
type View = 'users' | 'premium' | 'settings' | 'blocks' | 'audit';
type AccountAction = 'edit' | 'password' | 'delete';

const dateTime = (value: string | null) => {
  if (!value) return '—';
  const time = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z');
  return Number.isNaN(time.getTime()) ? '—' : time.toLocaleString(formatLocale, { dateStyle: 'short', timeStyle: 'short' });
};
const write = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
const errorText = (error: unknown) => error instanceof Error ? error.message : uiText("Не удалось связаться с сервером");

function initialToken() {
  try { return sessionStorage.getItem(ADMIN_SESSION) || ''; } catch { return ''; }
}

export function AdminApp() {
  const token = useRef(initialToken());
  const polling = useRef<AbortController | null>(null);
  const lastPoll = useRef(0);
  const [actor, setActor] = useState<User | null>(null);
  const [checking, setChecking] = useState(Boolean(token.current));
  const [view, setView] = useState<View>('users');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [support, setSupport] = useState('');
  const [prices, setPrices] = useState<Prices | null>(null);
  const [samples, setSamples] = useState<Stats[]>([]);
  const [refreshError, setRefreshError] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<{ id: number; offset: number; data: History } | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [blockOffset, setBlockOffset] = useState(0);
  const [blockTotal, setBlockTotal] = useState(0);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [accountAction, setAccountAction] = useState<{ id: number; kind: AccountAction } | null>(null);

  const forget = useCallback(() => {
    token.current = '';
    polling.current?.abort();
    try { sessionStorage.removeItem(ADMIN_SESSION); } catch { /* unavailable storage */ }
    setActor(null);
    setSamples([]);
    setRefreshError(false);
    setUsers([]);
    setHistory(null);
    setBlocks([]);
    setAudit([]);
    setPrices(null);
    setAccountAction(null);
  }, []);
  const api = useMemo(() => createApiClient({ getToken: () => token.current, onUnauthorized: forget, onMutationError: () => {} }), [forget]);

  useEffect(() => {
    let active = true;
    document.title = uiText("Администрирование · PetCare");
    void api<Contact>('/auth/support').then(result => {
      if (active && result) setSupport(result.support_contact);
    }).catch(() => {});
    if (token.current) void api<User>('/auth/session').then(result => {
      if (!active) return;
      if (result?.is_admin) setActor(result);
      else forget();
    }).catch(() => { if (active) forget(); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [api, forget]);

  const refreshUsers = useCallback(async (page: number, query: string, signal?: AbortSignal) => {
    const result = await api<{ users: UserRow[]; total: number }>('/admin/users?offset=' + page + '&search=' + encodeURIComponent(query), { signal });
    if (result && !signal?.aborted) {
      setUsers(result.users);
      setTotal(result.total);
      setOffset(page);
      setSearch(query);
    }
  }, [api]);

  const refreshStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await api<Stats>('/admin/status', { signal, cache: 'no-store' });
      if (result && !signal?.aborted && token.current) {
        setSamples(previous => appendSample(previous, result));
        setRefreshError(false);
      }
    } catch (cause) {
      if (!signal?.aborted && token.current) setRefreshError(true);
      throw cause;
    }
  }, [api]);

  useEffect(() => {
    if (!actor) return;
    void Promise.all([refreshStats(), refreshUsers(0, '')]).catch(cause => setError(errorText(cause)));
  }, [actor, refreshStats, refreshUsers]);

  async function task(action: () => Promise<unknown>, success = '') {
    if (busy) return;
    polling.current?.abort();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (success) setNotice(success);
    } catch (cause) {
      if (cause instanceof ApiError && cause.support) setSupport(cause.support);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void task(async () => {
      try {
        const result = await api<Login>('/auth/login', write('POST', data));
        if (!result?.user.is_admin) {
          if (result) {
            token.current = result.access_token;
            try { await api('/auth/logout', { method: 'POST' }); } finally { forget(); }
          }
          throw new Error(uiText("Для входа в панель нужна роль администратора."));
        }
        token.current = result.access_token;
        try {
          sessionStorage.setItem(ADMIN_SESSION, token.current);
          localStorage.removeItem(STANDARD_SESSION);
        } catch { /* this tab can still use the in-memory session */ }
        setActor(result.user);
      } finally {
        form.reset();
      }
    });
  }

  const refreshHistory = useCallback(async (id: number, page: number, signal?: AbortSignal) => {
    const data = await api<History>('/admin/users/' + id + '/sessions?offset=' + page, { signal });
    if (data && !signal?.aborted) setHistory({ id, data, offset: page });
  }, [api]);

  const refreshBlocks = useCallback(async (page = 0, signal?: AbortSignal) => {
    const result = await api<{ ips: Block[]; total: number }>('/admin/blocked-ips?offset=' + page, { signal });
    if (result && !signal?.aborted) {
      setBlocks(result.ips);
      setBlockTotal(result.total);
      setBlockOffset(page);
    }
  }, [api]);

  const refreshAudit = useCallback(async (signal?: AbortSignal) => {
    const result = await api<Audit[]>('/admin/audit', { signal });
    if (result && !signal?.aborted) setAudit(result);
  }, [api]);

  const historyId = history?.id;
  const historyOffset = history?.offset ?? 0;
  useEffect(() => {
    if (!actor || busy) return;
    const poll = () => {
      if (document.hidden || polling.current || Date.now() - lastPoll.current < REFRESH_MS - 100) return;
      const controller = new AbortController();
      polling.current = controller;
      lastPoll.current = Date.now();

      const requests = [refreshStats(controller.signal)];
      if (view === 'users') {
        requests.push(refreshUsers(offset, search, controller.signal));
        if (historyId != null) requests.push(refreshHistory(historyId, historyOffset, controller.signal));
      }
      if (view === 'blocks') requests.push(refreshBlocks(blockOffset, controller.signal));
      if (view === 'audit') requests.push(refreshAudit(controller.signal));
      void Promise.allSettled(requests).finally(() => {
        if (polling.current === controller) polling.current = null;
      });
    };
    const timer = window.setInterval(poll, REFRESH_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      polling.current?.abort();
      polling.current = null;
    };
  }, [actor, busy, view, offset, search, historyId, historyOffset, blockOffset, refreshStats, refreshUsers, refreshHistory, refreshBlocks, refreshAudit]);

  function openView(next: View) {
    setView(next);
    setAccountAction(null);
    setError('');
    setNotice('');
    if (next === 'premium') {
      setPrices(null);
      void task(async () => {
        const data = await api<{ prices: Prices }>('/admin/premium-prices', { cache: 'no-store' });
        if (data) setPrices(data.prices);
      });
    }
    if (next === 'blocks') void task(() => refreshBlocks());
    if (next === 'settings') void task(async () => {
      const data = await api<Contact>('/admin/settings');
      if (data) setSupport(data.support_contact);
    });
    if (next === 'audit') void task(() => refreshAudit());
  }

  function updateUser(id: number, action: string, data: unknown, message: string) {
    void task(async () => {
      await api('/admin/users/' + id + '/' + action, write('PATCH', data));
      await refreshUsers(offset, search);
      if (history?.id === id) await refreshHistory(id, history.offset);
    }, message);
  }

  function manageAccount(event: FormEvent<HTMLFormElement>, user: UserRow, kind: AccountAction) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const path = '/admin/users/' + user.id;
    if (kind === 'password' && data.new_password !== data.confirm_password) {
      setError(uiText("Новые пароли не совпадают."));
      return;
    }
    delete data.confirm_password;
    void task(async () => {
      const result = await api<User & { sessions_revoked?: boolean }>(
        path + (kind === 'edit' ? '' : '/' + kind),
        write(kind === 'delete' ? 'POST' : 'PATCH', data),
      );
      form.reset();
      setAccountAction(null);
      if (actor?.id === user.id && (kind === 'password' || result?.sessions_revoked)) {
        forget();
        return;
      }
      if (actor?.id === user.id && result) setActor(result);
      if (kind === 'delete' && history?.id === user.id) setHistory(null);
      else if (history?.id === user.id) await refreshHistory(user.id, 0);
      await refreshUsers(kind === 'delete' && users.length === 1 ? Math.max(0, offset - PAGE) : offset, search);
      await refreshStats();
    }, { edit: uiText("Данные аккаунта сохранены."), password: uiText("Пароль изменён. Прежние сеансы завершены."), delete: uiText("Аккаунт удалён.") }[kind]);
  }

  if (checking) return <main className="admin-login"><p role="status">{uiText("Проверяем доступ…")}</p></main>;
  if (!actor) return (
    <main className="admin-login">
      <div className="admin-login-card">
        <p className="admin-kicker"><BrandName /></p>
        <LanguagePicker />
        <h1>{uiText("Вход администратора")}</h1>
        <form onSubmit={login} className="admin-fields">
          <label>{uiText("Логин или электронная почта")}<input name="email" required maxLength={254} autoComplete="username" /></label>
          <label>{uiText("Пароль")}<input name="password" type="password" required autoComplete="current-password" /></label>
          <button type="submit" className="admin-primary" disabled={busy}>{busy ? uiText("Проверяем…") : uiText("Войти в панель")}</button>
        </form>
        {notice && <p className="admin-notice" role="status">{notice}</p>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {support && <p className="admin-muted">{uiText("Поддержка ·")+" "}{support}</p>}
        <a href="/">{uiText("К сайту PetCare")}</a>
      </div>
    </main>
  );

  return <div className="admin-shell">
    <aside className="admin-nav">
      <span className="admin-kicker"><BrandName /></span><LanguagePicker />
      <strong>{uiText("Управление")}</strong>
      <nav aria-label={uiText("Разделы панели")}>
        {([['users', uiText("Пользователи")], ['premium', uiText("Тарифы Premium")], ['settings', uiText("Настройки")], ['blocks', uiText("Блокировки IP")], ['audit', uiText("Журнал действий")]] as const).map(([key, label]) =>
          <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => openView(key)}>{label}</button>)}
      </nav>
      <button type="button" disabled={busy} onClick={() => void task(async () => {
        await api('/auth/logout', { method: 'POST' });
        forget();
      })}>{uiText("Выйти")}</button>
    </aside>
    <main className="admin-main">
      <header className="admin-heading"><div><p className="admin-muted">{uiText("Панель администратора")}</p><h1>{actor.full_name}</h1></div>
        <button type="button" disabled={busy} onClick={() => void task(() => refreshStats())}>{uiText("Обновить показатели")}</button></header>
      <ServerMetrics samples={samples} refreshError={refreshError} />
      <div className="admin-messages" aria-live="polite">
        {notice && <p className="admin-notice">{notice}</p>}
        {error && !accountAction && <p className="admin-error" role="alert">{error}</p>}
      </div>
      {view === 'users' && <section className="admin-panel">
        <header className="admin-heading"><h2>{uiText("Пользователи")+" "}<span className="admin-muted">{total}</span></h2>
          <form className="admin-row" onSubmit={event => {
            event.preventDefault();
            const query = String(new FormData(event.currentTarget).get('search') ?? '').trim();
            setAccountAction(null);
            void task(() => refreshUsers(0, query));
          }}>
            <input name="search" type="search" maxLength={100} aria-label={uiText("Поиск пользователей")} placeholder={uiText("Имя, почта или логин")} />
            <button type="submit" disabled={busy}>{uiText("Найти")}</button>
          </form>
        </header>
        <details className="admin-create">
          <summary>{uiText("Создать аккаунт")}</summary>
          <p className="admin-muted">{uiText("Этот аккаунт сможет войти сразу. Почта останется неподтверждённой.")}</p>
          <form className="admin-fields admin-create-fields" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            void task(async () => {
              await api('/admin/users', write('POST', data));
              form.reset();
              await Promise.all([refreshUsers(0, ''), refreshStats()]);
            }, uiText("Аккаунт создан."));
          }}>
            <label>{uiText("Имя")}<input name="full_name" required maxLength={100} /></label>
            <label>{uiText("Электронная почта")}<input name="email" required type="email" maxLength={254} /></label>
            <label>{uiText("Начальный пароль")}<input name="password" required type="password" minLength={8} maxLength={72} autoComplete="new-password" /></label>
            <button className="admin-primary" type="submit" disabled={busy}>{uiText("Создать")}</button>
          </form>
        </details>
        <ul className="admin-users">
          {users.map(user => <li key={user.id} className="admin-user">
            <div className="admin-user-head">
              <div><h3>{user.full_name}</h3><p className="admin-muted">{user.email}{user.admin_login ? ' · ' + user.admin_login : ''} · ID {user.id}{" · "+uiText("Питомцев:")+" "}{user.pet_count}</p></div>
              <div className="admin-badges">
                <span className={user.is_admin ? 'admin-badge accent' : 'admin-badge'}>{user.is_admin ? uiText("Администратор") : uiText("Пользователь")}</span>
                <span className={user.disabled ? 'admin-badge danger' : 'admin-badge'}>{user.disabled ? uiText("Заблокирован") : uiText("Активен")}</span>
                <span className="admin-badge">{user.email_verified ? uiText("Почта подтверждена") : uiText("Почта не подтверждена")}</span>
                <span className="admin-badge">{user.premium ? (user.premium_until ? (uiText("Доступ до")+" ") + dateTime(user.premium_until) : uiText("Бессрочный доступ")) : uiText("Бесплатный доступ")}</span>
              </div>
            </div>
            <div className="admin-row">
              {(['edit', 'password', 'delete'] as const).filter(kind => kind !== 'delete' || !user.is_admin).map(kind =>
                <button key={kind} type="button" disabled={busy} aria-expanded={accountAction?.id === user.id && accountAction.kind === kind} onClick={() => {
                  setError('');
                  setAccountAction(accountAction?.id === user.id && accountAction.kind === kind ? null : { id: user.id, kind });
                }}>{{ edit: uiText("Изменить данные"), password: uiText("Сменить пароль"), delete: uiText("Удалить аккаунт") }[kind]}</button>
              )}
              {user.id !== actor.id && <button type="button" disabled={busy || (!user.is_admin && user.disabled)} onClick={() => {
                if (window.confirm(user.is_admin ? uiText("Снять права администратора и завершить его текущие сеансы?") : uiText("Выдать полный доступ к панели администратора и завершить текущие сеансы пользователя?"))) {
                  updateUser(user.id, 'role', { is_admin: !user.is_admin }, uiText("Роль изменена."));
                }
              }}>{user.is_admin ? uiText("Снять роль администратора") : uiText("Назначить администратором")}</button>}
              {!user.is_admin && <button type="button" disabled={busy} onClick={() => updateUser(user.id, 'blocked', { blocked: !user.disabled }, uiText("Статус аккаунта изменён."))}>{user.disabled ? uiText("Разблокировать") : uiText("Заблокировать")}</button>}
              <button type="button" disabled={busy} onClick={() => void task(
                () => api('/admin/users/' + user.id + '/clear-login-lock', { method: 'POST' }),
                uiText("Счётчик неверных паролей сброшен."),
              )}>{uiText("Сбросить блок входа")}</button>
              <button type="button" disabled={busy} aria-expanded={history?.id === user.id} onClick={() => history?.id === user.id ? setHistory(null) : void task(() => refreshHistory(user.id, 0))}>{uiText("История входов")}</button>
              {user.id !== actor.id && <button type="button" disabled={busy} onClick={() => void task(async () => {
                await api('/admin/users/' + user.id + '/revoke-sessions', { method: 'POST' });
                await refreshStats();
                if (history?.id === user.id) await refreshHistory(user.id, 0);
              }, uiText("Сеансы завершены."))}>{uiText("Завершить сеансы")}</button>}
            </div>
            <details className="admin-premium">
              <summary>{uiText("Изменить тариф")}</summary>
              <form className="admin-row admin-premium-form" onSubmit={event => {
                event.preventDefault();
                const days = Number(new FormData(event.currentTarget).get('days'));
                if (!Number.isInteger(days) || days < 1 || days > MAX_PREMIUM_DAYS) {
                  setError((uiText("Введите целое число дней от 1 до")+" ") + MAX_PREMIUM_DAYS + '.');
                  return;
                }
                updateUser(user.id, 'premium', { enabled: true, days }, uiText("Срок Premium обновлён."));
              }}>
                <label>{uiText("Дней Premium")}<input name="days" type="number" inputMode="numeric" min={1} max={MAX_PREMIUM_DAYS} step={1} placeholder="30" required disabled={busy} /></label>
                <button className="admin-primary" type="submit" disabled={busy}>{uiText("Сохранить срок")}</button>
              </form>
              <p className="admin-muted">{uiText("Новый срок отсчитывается с момента сохранения.")}</p>
              <div className="admin-row">
                <button type="button" disabled={busy} onClick={() => updateUser(user.id, 'premium', { enabled: true }, uiText("Включён бессрочный Premium."))}>{uiText("Бессрочный доступ")}</button>
                <button type="button" disabled={busy} onClick={() => updateUser(user.id, 'premium', { enabled: false }, uiText("Включён бесплатный тариф."))}>{uiText("Бесплатный тариф")}</button>
              </div>
            </details>
            {accountAction?.id === user.id && <form key={accountAction.kind} className="admin-fields admin-account-form"
              onSubmit={event => manageAccount(event, user, accountAction.kind)}>
              {accountAction.kind === 'edit' && <>
                <label>{uiText("Имя")}<input name="full_name" required maxLength={100} defaultValue={user.full_name} /></label>
                <label>{uiText("Электронная почта")}<input name="email" required type="email" maxLength={254} defaultValue={user.email} /></label>
                <label>{uiText("Часовой пояс")}<input name="timezone" required maxLength={50} defaultValue={user.timezone} /></label>
                {user.is_admin && <label>{uiText("Логин администратора")}<input name="admin_login" maxLength={64} defaultValue={user.admin_login ?? ''} /></label>}
                <p className="admin-muted">{uiText("После изменения почты или логина пользователь войдёт заново. Новый адрес потребуется подтвердить.")}</p>
              </>}
              {accountAction.kind === 'password' && <>
                <label>{uiText("Новый пароль")}<input name="new_password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
                <label>{uiText("Повторите новый пароль")}<input name="confirm_password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /></label>
                <p className="admin-muted">{uiText("Действующие сеансы и старые коды подтверждения будут аннулированы.")}</p>
              </>}
              {accountAction.kind === 'delete' && <>
                <p className="admin-error">{uiText("Аккаунт, его питомцы и их записи будут удалены без возможности восстановления.")}</p>
                <label>{uiText("Введите")+" "}{user.email}{" "+uiText("для подтверждения")}<input name="confirmation_email" type="email" required maxLength={254} autoComplete="off" /></label>
              </>}
              <label>{uiText("Ваш текущий пароль администратора")}<input name="current_password" type="password" autoComplete="current-password" maxLength={256} required /></label>
              {error && <p className="admin-error" role="alert">{error}</p>}
              <div className="admin-row">
                <button type="submit" className="admin-primary" disabled={busy}>{accountAction.kind === 'delete' ? uiText("Удалить навсегда") : uiText("Сохранить")}</button>
                <button type="button" disabled={busy} onClick={() => { setAccountAction(null); setError(''); }}>{uiText("Отмена")}</button>
              </div>
            </form>}
            {history?.id === user.id && <div className="admin-history">
              {!history.data.sessions.length && <p className="admin-muted">{uiText("Входов пока нет.")}</p>}
              {history.data.sessions.map((item, index) => <div key={index} className="admin-session">
                <strong>{item.ip_address || uiText("IP не записан")}</strong><span>{dateTime(item.created_at)}</span>
                <span>{item.active ? uiText("Активен") : uiText("Завершён")}</span><small>{item.device}</small>
              </div>)}
              <Pager total={history.data.total} offset={history.offset} busy={busy} onPage={page => void task(() => refreshHistory(user.id, page))} />
            </div>}
          </li>)}
        </ul>
        {!users.length && <p className="admin-muted">{uiText("Пользователи не найдены.")}</p>}
        <Pager total={total} offset={offset} busy={busy} onPage={page => void task(() => refreshUsers(page, search))} />
      </section>}
      {view === 'premium' && <section className="admin-panel">
        <h2>{uiText('Тарифы Premium')}</h2>
        <p className="admin-muted">{uiText('Укажите цену в рублях за весь период. Новая цена применяется к новым заказам.')}</p>
        {prices ? <form className="admin-fields" onSubmit={event => {
          event.preventDefault();
          void task(async () => {
            const data = await api<{ prices: Prices }>('/admin/premium-prices', write('PUT', { prices }));
            if (data) setPrices(data.prices);
          }, uiText('Цены Premium сохранены.'));
        }}>
          <div className="admin-price-grid">{periods.map(period => <label key={period.months}>
            {period.label}
            <input name={String(period.months)} type="number" required min={1} max={maxPremiumPrice} step={1}
              value={prices[period.months] || ''} disabled={busy} onChange={event => {
                const value = event.currentTarget.valueAsNumber;
                setPrices({ ...prices, [period.months]: Number.isFinite(value) ? value : 0 });
              }} />
          </label>)}</div>
          <button type="submit" className="admin-primary" disabled={busy}>{uiText('Сохранить цены')}</button>
        </form> : busy ? <p role="status">{uiText('Загружаем…')}</p> :
          <button type="button" onClick={() => openView('premium')}>{uiText('Повторить')}</button>}
      </section>}
      {view === 'settings' && <section className="admin-panel">
        <h2>{uiText("Способ связи с поддержкой")}</h2>
        <form className="admin-fields" onSubmit={event => {
          event.preventDefault();
          void task(async () => {
            const data = await api<Contact>('/admin/settings', write('PATCH', { support_contact: support }));
            if (data) setSupport(data.support_contact);
          }, uiText("Контакт сохранён."));
        }}>
          <label>{uiText("Почта, ссылка или другой контакт")}<textarea rows={3} maxLength={500} value={support} onChange={event => setSupport(event.target.value)} /></label>
          <button type="submit" className="admin-primary" disabled={busy}>{uiText("Сохранить контакт")}</button>
        </form>
      </section>}
      {view === 'blocks' && <section className="admin-panel">
        <h2>{uiText("Блокировки IP")}</h2>
        {!blocks.length && <p className="admin-muted">{uiText("Заблокированных IP нет.")}</p>}
        <ul className="admin-users">{blocks.map(block => <li className="admin-user admin-row" key={block.ip_address}>
          <strong>{block.ip_address}</strong><span className="admin-muted">{dateTime(block.blocked_at)}{" · "+uiText("Ошибок:")+" "}{block.failures}</span>
          <button type="button" disabled={busy} onClick={() => void task(async () => {
            await api('/admin/blocked-ips/' + encodeURIComponent(block.ip_address), { method: 'DELETE' });
            await refreshBlocks();
          }, uiText("Блокировка снята."))}>{uiText("Снять блокировку")}</button>
        </li>)}</ul>
        <Pager total={blockTotal} offset={blockOffset} busy={busy} onPage={page => void task(() => refreshBlocks(page))} />
      </section>}
      {view === 'audit' && <section className="admin-panel">
        <h2>{uiText("Журнал действий")}</h2>
        {!audit.length && <p className="admin-muted">{uiText("Действий пока нет.")}</p>}
        <ul className="admin-users">{audit.map((item, index) => <li className="admin-user admin-row" key={index}>
          <strong>{auditLabel(item.action)}</strong><span className="admin-muted">{dateTime(item.at)}{" · "+uiText("Администратор")+" "}{item.actor_id}{" · "+uiText("Пользователь")+" "}{item.target_id}</span>
        </li>)}</ul>
      </section>}
    </main>
  </div>;
}

function Pager({ total, offset, busy, onPage }: { total: number; offset: number; busy: boolean; onPage: (page: number) => void }) {
  if (total <= PAGE) return null;
  return <div className="admin-row admin-pager">
    <button type="button" disabled={busy || !offset} onClick={() => onPage(Math.max(0, offset - PAGE))}>{uiText("Назад")}</button>
    <span>{offset + 1}–{Math.min(total, offset + PAGE)}{" "+uiText("из")+" "}{total}</span>
    <button type="button" disabled={busy || offset + PAGE >= total} onClick={() => onPage(offset + PAGE)}>{uiText("Дальше")}</button>
  </div>;
}

function auditLabel(action: string) {
  if (action.startsWith('unblock_ip:')) return (uiText("Снят блок IP")+" ") + action.slice(11);
  if (action.startsWith('premium:')) return uiText("Изменён тариф");
  switch (action) {
    case 'create_without_email_code': return uiText("Создан аккаунт без кода");
    case 'edit_account': return uiText("Изменены данные аккаунта");
    case 'change_password': return uiText("Изменён пароль");
    case 'clear_login_lock': return uiText("Сброшен счётчик неверных паролей");
    case 'delete_account': return uiText("Удалён аккаунт");
    case 'role:admin': return uiText("Выданы права администратора");
    case 'role:user': return uiText("Сняты права администратора");
    case 'blocked:True': return uiText("Аккаунт заблокирован");
    case 'blocked:False': return uiText("Аккаунт разблокирован");
    case 'revoke_sessions': return uiText("Завершены сеансы");
    case 'update_premium_prices': return uiText('Изменены цены Premium');
    case 'update_support_contact': return uiText("Изменён контакт поддержки");
    default: return action;
  }
}
