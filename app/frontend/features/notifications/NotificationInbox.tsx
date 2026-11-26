import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { formatLocale, language } from '../../i18n';
import { createApiClient } from '../../lib/api';
import { getAppearance, subscribeAppearance } from '../appearance/store';
import './inbox.css';

const api = createApiClient({
  browserSession: true, getToken: () => 'browser-session', onUnauthorized: () => {}, onMutationError: () => {},
});
const route = '#/profile/notifications';
const strings = {
  ru: { title: 'Центр уведомлений', subtitle: 'Объявления PetCare и напоминания', empty: 'Уведомлений пока нет.',
    loading: 'Загружаем уведомления…', error: 'Не удалось загрузить уведомления.', retry: 'Повторить',
    more: 'Показать более ранние', open: 'Все уведомления', close: 'Закрыть' },
  en: { title: 'Notification centre', subtitle: 'PetCare announcements and reminders', empty: 'No notifications yet.',
    loading: 'Loading notifications…', error: 'Could not load notifications.', retry: 'Try again',
    more: 'Show earlier notifications', open: 'All notifications', close: 'Dismiss' },
};
const copy = strings[language];
type Notice = { id: number; title: string; body: string; broadcast: boolean; created_at: string };
type NoticePage = { items: Notice[]; next_before: number | null };

function mergeNotices(current: Notice[], incoming: Notice[]) {
  const notices = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) notices.set(item.id, item);
  return Array.from(notices.values()).sort((a, b) => b.id - a.id);
}

function Inbox() {
  const [items, setItems] = useState<Notice[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [announcement, setAnnouncement] = useState<Notice | null>(null);
  const [refresh, setRefresh] = useState(0);
  const newest = useRef<number | null>(null);
  const list = useRef<HTMLDetailsElement>(null);
  const historyRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let pending: AbortController | null = null;
    const load = async () => {
      if (document.hidden || pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const page = await api<NoticePage>('/notifications/inbox', { signal: controller.signal, cache: 'no-store' });
        if (!page || controller.signal.aborted) return;
        const newestId = newest.current;
        if (newestId === null || page.next_before !== null && !page.items.some(item => item.id <= newestId)) {
          setCursor(page.next_before);
        }
        const fresh = page.items.find(item => item.broadcast && newestId !== null && item.id > newestId);
        newest.current = Math.max(newestId ?? 0, page.items[0]?.id ?? 0);
        if (fresh) setAnnouncement(fresh);
        setItems(current => mergeNotices(current, page.items));
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      pending?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [refresh]);

  useEffect(() => {
    const open = () => {
      if (location.hash !== route || !list.current) return;
      list.current.open = true;
      requestAnimationFrame(() => list.current?.scrollIntoView({ block: 'start' }));
    };
    const onPush = (event: MessageEvent) => {
      if (event.data?.type !== 'petcare-open-inbox') return;
      if (location.hash === route) open();
      else location.hash = route;
    };
    open();
    window.addEventListener('hashchange', open);
    navigator.serviceWorker?.addEventListener('message', onPush);
    return () => {
      window.removeEventListener('hashchange', open);
      navigator.serviceWorker?.removeEventListener('message', onPush);
      historyRequest.current?.abort();
    };
  }, []);

  async function earlier() {
    if (!cursor || historyRequest.current) return;
    const controller = new AbortController();
    historyRequest.current = controller;
    setLoadingEarlier(true);
    try {
      const page = await api<NoticePage>(`/notifications/inbox?before=${cursor}`, { signal: controller.signal });
      if (!page || controller.signal.aborted) return;
      setItems(current => mergeNotices(current, page.items));
      setCursor(page.next_before);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      historyRequest.current = null;
      if (!controller.signal.aborted) setLoadingEarlier(false);
    }
  }

  return <>
    <details ref={list} className="settings-group notice-inbox" id="notification-inbox">
      <summary><span>{copy.title}<small>{copy.subtitle}</small></span></summary>
      <div className="settings-body">
        {loading && <p role="status">{copy.loading}</p>}
        {error && <div role="status"><p>{copy.error}</p><button type="button" className="btn tiny" onClick={() => setRefresh(value => value + 1)}>{copy.retry}</button></div>}
        {!loading && !error && !items.length && <p>{copy.empty}</p>}
        {items.length > 0 && <ul className="notice-list">{items.map(item => <li key={item.id}>
          <strong>{item.title}</strong>
          <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          <p>{item.body}</p>
        </li>)}</ul>}
        {cursor && <button className="btn tiny" type="button" disabled={loadingEarlier} onClick={() => void earlier()}>{copy.more}</button>}
      </div>
    </details>
    {announcement && createPortal(<aside className="notice-toast" aria-label={copy.title}>
      <div role="status"><strong>{announcement.title}</strong><p>{announcement.body}</p></div>
      <a href={route} onClick={() => { if (list.current) list.current.open = true; setAnnouncement(null); }}>{copy.open}</a>
      <button type="button" aria-label={copy.close} onClick={() => setAnnouncement(null)}>×</button>
    </aside>, document.body)}
  </>;
}

export function NotificationInbox() {
  const { accountId } = useSyncExternalStore(subscribeAppearance, getAppearance);
  return accountId !== null ? <Inbox key={accountId} /> : null;
}
