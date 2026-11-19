import messages from './en';

export type Language = 'ru' | 'en';
export type LanguagePreference = Language | 'auto';
const storageKey = 'petcare.language';

export function browserLanguage(languages: readonly string[]): Language {
  for (const locale of languages) {
    const code = locale.toLowerCase().split(/[-_]/)[0];
    if (code === 'en' || code === 'ru') return code;
  }
  return languages.length ? 'en' : 'ru';
}

function savedPreference(): LanguagePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return value === 'ru' || value === 'en' ? value : 'auto';
  } catch { return 'auto'; }
}

export const languagePreference = savedPreference();
export const language: Language = languagePreference === 'auto'
  ? browserLanguage(typeof window === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language])
  : languagePreference;
export const formatLocale = language === 'en' ? 'en-GB' : 'ru-RU';

export function uiText(original: string): string {
  if (language !== 'en') return original;
  return Object.hasOwn(messages, original) ? messages[original] : original;
}

export function htmlUiText(original: string): string {
  if (language !== 'en') return original;
  return uiText(original).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] ?? character));
}

export function setLanguagePreference(preference: LanguagePreference): void {
  if (preference === 'auto') localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, preference);
  window.location.reload();
}
