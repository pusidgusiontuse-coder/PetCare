import { uiText } from '../../i18n';
export const themes = [
  { id: 'olive-honey', label: uiText("Олива и мёд") },
  { id: 'clay-milk', label: uiText("Глина и молоко") },
  { id: 'night-forest', label: uiText("Ночной лес") },
  { id: 'forest-linen', label: uiText("Лес и лён") },
  { id: 'mandarin', label: uiText("Мандарин") },
  { id: 'night-ocean', label: uiText("Ночной океан") },
] as const;

type Theme = (typeof themes)[number]['id'];
type Account = { id: number; theme?: string };
type SaveTheme = (theme: Theme) => Promise<{ theme: string } | null>;
type Appearance = { accountId: number | null; theme: Theme; saving: boolean; feedback: string };

const defaultTheme = themes[0].id;
const deviceKey = 'petcare.appearance';
const accountKey = (id: number) => `${deviceKey}.${id}`;

function readTheme(key: string) {
  try {
    const stored = localStorage.getItem(key);
    return themes.find(option => option.id === stored)?.id;
  } catch { return undefined; }
}

function rememberTheme(id: number, theme: Theme) {
  try {
    localStorage.setItem(deviceKey, theme);
    localStorage.setItem(accountKey(id), theme);
    return true;
  } catch { return false; }
}

let deviceTheme = readTheme(deviceKey);
let current: Appearance = { accountId: null, theme: deviceTheme ?? defaultTheme, saving: false, feedback: '' };
let saveTheme: SaveTheme | undefined;
let accountVersion = 0;
const listeners = new Set<() => void>();

function resolveTheme(theme: string | undefined) {
  return themes.find(item => item.id === theme)?.id ?? defaultTheme;
}

function publish(next: Appearance) {
  current = next;
  document.documentElement.dataset.petcareTheme = next.theme;
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
  listeners.forEach(listener => listener());
}

if (typeof document !== 'undefined') publish(current);

export function setAppearanceAccount(account: Account | null, save?: SaveTheme) {
  // Read the saved theme when a new session loads. Background profile refreshes
  // must not overwrite a choice that was just made in this page.
  if (current.accountId === (account?.id ?? null)) return;
  accountVersion += 1;
  saveTheme = account ? save : undefined;
  const theme = account ? readTheme(accountKey(account.id)) ?? resolveTheme(account.theme) : deviceTheme ?? defaultTheme;
  if (account) {
    deviceTheme = theme;
    try { localStorage.setItem(deviceKey, theme); } catch { /* use the in-memory fallback */ }
  }
  publish({ accountId: account?.id ?? null, theme, saving: false, feedback: '' });
}

export const getAppearance = () => current;
export function subscribeAppearance(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function chooseTheme(theme: Theme) {
  if (!saveTheme || current.accountId === null || current.saving || theme === current.theme) return;
  const previous = current;
  const persisted = rememberTheme(current.accountId, theme);
  if (persisted) deviceTheme = theme;
  const version = accountVersion;
  publish({ ...previous, theme, saving: true, feedback: uiText("Сохраняем тему…") });
  try {
    const result = await saveTheme(theme);
    if (!result || result.theme !== theme) throw new Error('Theme was not persisted');
    if (version === accountVersion) {
      deviceTheme = theme;
      publish({ ...previous, theme, saving: false, feedback: uiText("Тема сохранена.") });
    }
  } catch {
    if (version === accountVersion) publish({ ...previous, theme: persisted ? theme : previous.theme, saving: false,
      feedback: uiText(persisted ? 'Тема сохранена на этом устройстве. Синхронизация не удалась.' : 'Не удалось сохранить тему. Попробуйте ещё раз.') });
  }
}
