import { useEffect, useRef, type CSSProperties } from 'react';
import { language } from '../../i18n';
import { isGreetingDay } from './season';
import './midnight.css';

const seenKey = 'petcare.newYear2027Greeting';
const bursts = [
  [20, 26, 0.2, '#ffd075'], [77, 22, 0.4, '#fd8ea0'], [52, 13, 0.7, '#bfe8ff'],
  [15, 67, 1.1, '#ff9b8c'], [84, 69, 1.3, '#a0eccd'], [52, 77, 1.6, '#f9dca1'],
] as const;

export function MidnightGreeting() {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('fireworks') === '1';

  useEffect(() => {
    const panel = dialog.current;
    if (!panel || (!preview && !isGreetingDay(Date.now()))) return;
    try { if (!preview && localStorage.getItem(seenKey)) return; } catch { /* storage can be unavailable */ }
    panel.showModal();
    if (!preview) {
      try { localStorage.setItem(seenKey, '1'); } catch { /* the greeting still works without storage */ }
    }
    const timer = window.setTimeout(() => panel.close(), 6800);
    return () => { window.clearTimeout(timer); panel.close(); };
  }, [preview]);

  if (!preview && !isGreetingDay(Date.now())) return null;

  return <dialog ref={dialog} className="midnight-greeting" aria-labelledby="midnight-title">
    <div className="midnight-sky" aria-hidden="true">
      {bursts.map(([left, top, delay, color]) => <div className="midnight-burst" key={left + ':' + top}
        style={{ left: `${left}%`, top: `${top}%`, color, '--burst-delay': `${delay}s` } as CSSProperties}>
        {Array.from({ length: 12 }, (_, index) => <i key={index}
          style={{ '--ray': `${index * 30 + left}deg`, '--distance': `${index % 3 === 0 ? .62 : 1}` } as CSSProperties} />)}
      </div>)}
    </div>
    <div className="midnight-message">
      <h2 id="midnight-title">{language === 'en' ? 'Happy New Year' : 'С Новым годом'}<strong>2027!</strong></h2>
      <p>{language === 'en' ? 'A warm year ahead for you and your pets.' : 'Тёплого года вам и вашим питомцам.'}</p>
    </div>
    <button className="midnight-close" type="button" onClick={() => dialog.current?.close()}>
      {language === 'en' ? 'Continue to PetCare' : 'Перейти в PetCare'}
    </button>
  </dialog>;
}
