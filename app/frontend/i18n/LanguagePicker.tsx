import { useState } from 'react';
import { languagePreference, setLanguagePreference, uiText, type LanguagePreference } from './index';

export function LanguagePicker() {
  const [error, setError] = useState(false);
  return <label className="language-picker">
    <span>{uiText('Язык')}</span>
    <select defaultValue={languagePreference} onChange={event => {
      try { setLanguagePreference(event.currentTarget.value as LanguagePreference); }
      catch { setError(true); }
    }}>
      <option value="auto">{uiText('Язык браузера')}</option>
      <option value="en" lang="en">English</option>
      <option value="ru" lang="ru">Русский</option>
    </select>
    {error && <small role="status">{uiText('Не удалось сохранить язык.')}</small>}
  </label>;
}
