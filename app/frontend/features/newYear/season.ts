import { useEffect, useState, useSyncExternalStore } from 'react';

export const NEW_YEAR_START = Date.parse('2026-12-01T00:00:00+03:00');
const greetingStart = Date.parse('2027-01-01T00:00:00+03:00');
const greetingEnd = Date.parse('2027-01-02T00:00:00+03:00');

export function isGreetingDay(now: number): boolean {
  return now >= greetingStart && now < greetingEnd;
}

export function isNewYearSeason(now: number, preview = false): boolean {
  return preview || now >= NEW_YEAR_START;
}

function useNewYearSeason(): boolean {
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).get('new-year') === '1';
  const [active, setActive] = useState(() => isNewYearSeason(Date.now(), preview));

  useEffect(() => {
    if (active) return;

    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      const remaining = NEW_YEAR_START - Date.now();
      if (remaining <= 0) setActive(true);
      else timer = window.setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active]);

  return active;
}

export const newYearModes = ['off', 'medium', 'max'] as const;
type NewYearMode = (typeof newYearModes)[number];
const modeKey = 'petcare.newYear';
const listeners = new Set<() => void>();

function readMode(): NewYearMode {
  try {
    const stored = localStorage.getItem(modeKey);
    return newYearModes.find(mode => mode === stored) ?? 'max';
  } catch { return 'max'; }
}

let mode = readMode();
const snapshot = () => mode;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function chooseNewYearMode(value: NewYearMode) {
  mode = value;
  try { localStorage.setItem(modeKey, value); } catch { /* keep the current page choice */ }
  listeners.forEach(listener => listener());
}

export function useNewYearAppearance() {
  return { active: useNewYearSeason(), mode: useSyncExternalStore(subscribe, snapshot) };
}
