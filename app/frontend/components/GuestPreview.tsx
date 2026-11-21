import { language, uiText } from '../i18n';
import { LanguagePicker } from '../i18n/LanguagePicker';
import { BetaFeedbackButton } from './BetaFeedback';

const sections = [
  { name: uiText("Питомцы"), icon: 'paw', detail: uiText("Карточки питомцев и совместный уход") },
  { name: uiText("Здоровье"), icon: 'heart', detail: uiText("Прививки, назначения и документы") },
  { name: uiText("Питание"), icon: 'food', detail: uiText("Рацион и расписание кормлений") },
  { name: uiText("Уход"), icon: 'clock', detail: uiText("Напоминания и история ухода") },
  { name: uiText("Друзья"), icon: 'spark', detail: uiText("Анкеты и поиск компании") },
];

export function LockIcon() {
  return <svg className="guest-lock-icon" aria-hidden="true"><use href="#lock" /></svg>;
}

export function GuestPreview() {
  return <section className="guest-preview" id="guest-preview" aria-labelledby="guest-preview-title" hidden>
    <header><LanguagePicker />
      <p className="guest-preview-label">{uiText("Гостевой режим")}</p>
      <h1 id="guest-preview-title">{uiText("Кабинет PetCare")}</h1>
      <p id="guest-preview-hint">{uiText("Войдите или зарегистрируйтесь, чтобы открыть разделы.")}</p>
      <a href={language === 'en' ? '/about?lang=en' : '/about'}>{uiText("О возможностях PetCare")}</a>
    </header>
    <ul className="guest-grid">
      {sections.map(section => <li key={section.name}>
        <button type="button" className="guest-card" data-guest-lock aria-haspopup="dialog" aria-describedby="guest-preview-hint">
          <span className="guest-card-symbol"><svg aria-hidden="true"><use href={'#' + section.icon} /></svg></span>
          <span className="guest-card-copy"><strong>{section.name}</strong><small>{section.detail}</small></span>
          <LockIcon />
        </button>
      </li>)}
    </ul>
    <div className="guest-feedback"><BetaFeedbackButton /></div>
  </section>;
}
