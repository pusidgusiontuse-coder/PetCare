import { uiText } from '../../i18n';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { chooseTheme, getAppearance, subscribeAppearance, themes } from './store';

export function ThemePicker() {
  const { accountId, theme, saving, feedback } = useSyncExternalStore(subscribeAppearance, getAppearance);
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  function updateEdges() {
    const lane = track.current;
    if (lane) setEdges({
      start: lane.scrollLeft < 2,
      end: lane.scrollLeft + lane.clientWidth >= lane.scrollWidth - 2,
    });
  }

  useEffect(() => {
    const lane = track.current;
    if (!lane) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(lane);
    updateEdges();
    return () => observer.disconnect();
  }, [accountId]);

  useEffect(() => {
    const lane = track.current;
    const chosen = lane?.querySelector('.theme-choice:has(input:checked)');
    if (!lane || !chosen) return;
    const laneBounds = lane.getBoundingClientRect();
    const cardBounds = chosen.getBoundingClientRect();
    if (cardBounds.left < laneBounds.left || cardBounds.right > laneBounds.right) {
      lane.scrollLeft += cardBounds.left - laneBounds.left - 4;
    }
  }, [accountId, theme]);

  function move(direction: number) {
    const lane = track.current;
    const card = lane?.firstElementChild;
    if (!lane || !card) return;
    lane.scrollBy({
      left: direction * (card.getBoundingClientRect().width + 12),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  if (accountId == null) return null;
  return (
    <section className="theme-picker panel" aria-labelledby="theme-picker-title">
      <div className="theme-picker-head">
        <h2 id="theme-picker-title">{uiText("Оформление")}</h2>
        <div className="theme-picker-controls">
          <button type="button" className="btn" aria-label={uiText("Предыдущие темы")} disabled={edges.start} onClick={() => move(-1)}>‹</button>
          <button type="button" className="btn" aria-label={uiText("Следующие темы")} disabled={edges.end} onClick={() => move(1)}>›</button>
        </div>
      </div>
      <div className="theme-track" ref={track} onScroll={updateEdges} role="radiogroup" aria-label={uiText("Цветовая тема")} aria-busy={saving}>
        {themes.map(option => (
          <label className="theme-choice" key={option.id}>
            <input type="radio" name="petcare-theme" value={option.id} checked={theme === option.id}
              aria-disabled={saving || undefined} onChange={() => void chooseTheme(option.id)}
              onFocus={event => event.currentTarget.closest('label')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })} />
            <span className="theme-choice-body">
              <span className="theme-thumb" data-petcare-theme={option.id} aria-hidden="true">
                <span className="theme-thumb-header"><span className="brand-mark" /><span /></span>
                <span className="theme-thumb-card"><span /><i /><i /></span>
                <span className="theme-thumb-action" />
              </span>
              <span className="theme-choice-label">
                {option.label}
                {theme === option.id && <span className="theme-choice-check" aria-hidden="true">✓</span>}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="theme-feedback" role="status">{feedback || uiText("Тема сохраняется в вашем аккаунте.")}</p>
    </section>
  );
}
