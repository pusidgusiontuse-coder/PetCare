import { uiText } from '../i18n';

export function Dialogs() {
  return (
    <>
      <dialog id="editor" aria-labelledby="editor-title" aria-describedby="editor-context">
        <div className="editor-close-bar"><button type="button" id="close-editor" className="modal-close" aria-label={uiText("Закрыть карточку или форму")} /></div>
        <form id="editor-form">
          <h2 id="editor-title" />
          <p id="editor-context" className="small" />
          <p id="editor-error" role="alert" tabIndex={-1} hidden />
          <div id="editor-fields" className="form-grid" />
          <div className="form-actions">
            <button type="button" className="btn ghost" id="cancel-editor">{uiText("Отмена")}</button>
            <button className="btn primary" type="submit">{uiText("Сохранить")}</button>
          </div>
        </form>
      </dialog>
      <dialog id="auth-dialog" className="auth-dialog" aria-labelledby="auth-dialog-title">
        <button type="button" id="close-auth-dialog" className="modal-close" aria-label={uiText("Закрыть окно входа")} />
        <div className="auth-header">
          <div className="auth-logo">
            <span className="brand-mark" aria-hidden="true" />
            petcare
            <span className="brand-dot">
              .
            </span>
          </div>
          <h2 id="auth-dialog-title" className="auth-title">{uiText("Вход в PetCare")}</h2>
          <p className="auth-sub">{uiText("Единый сервис заботы о здоровье, питании и совместном уходе за питомцами")}</p>
        </div>
        <div className="auth-tabs" role="tablist">
          <button type="button" className="auth-tab active" id="tab-login" role="tab" aria-selected="true">{uiText("Вход")}</button>
          <button type="button" className="auth-tab" id="tab-register" role="tab" aria-selected="false">{uiText("Регистрация")}</button>
        </div>
        <div id="auth-error" className="auth-error" role="alert" tabIndex={-1} hidden />
        <p id="auth-support" className="small" hidden />
        <form id="auth-form" className="auth-form">
          <div className="field" id="auth-name-field" hidden>
            <label htmlFor="auth-name">{uiText("Ваше имя")}</label>
            <input type="text" id="auth-name" name="name" autoComplete="name" placeholder={uiText("Илья Иванов")} />
          </div>
          <div className="field">
            <label htmlFor="auth-email" id="auth-email-label">{uiText("Почта или логин администратора")}</label>
            <input type="text" id="auth-email" name="username" spellCheck={false} required placeholder={uiText("Почта или логин администратора")} autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="auth-password">{uiText("Пароль")}</label>
            <input type="password" id="auth-password" name="password" required minLength={8} placeholder="••••••••" autoComplete="current-password" />
          </div>
          <button type="submit" className="btn primary auth-submit" id="auth-submit-btn">{uiText("Войти в аккаунт")}</button>
        </form>
        <button type="button" className="btn ghost auth-preview" id="auth-guest-preview">{uiText("Посмотреть без аккаунта")}</button>
      </dialog>
      <dialog id="temporal-picker" aria-labelledby="picker-title" aria-describedby="picker-context">
        <div className="picker-heading">
          <button type="button" className="modal-close" id="picker-close" aria-label={uiText("Закрыть выбор даты и времени")} />
          <h2 id="picker-title">{uiText("Выбрать дату")}</h2>
          <p className="picker-context" id="picker-context" />
        </div>
        <div className="picker-tabs" role="tablist" aria-label={uiText("Дата и время")} id="picker-tabs">
          <button type="button" role="tab" id="picker-date-tab" aria-controls="picker-date-panel" aria-selected="true">{uiText("Дата")}</button>
          <button type="button" role="tab" id="picker-time-tab" aria-controls="picker-time-panel" aria-selected="false" tabIndex={-1}>{uiText("Время")}</button>
        </div>
        <div id="picker-date-panel" role="tabpanel" aria-labelledby="picker-date-tab">
          <div className="calendar-toolbar">
            <button type="button" className="picker-icon" id="picker-prev" aria-label={uiText("Предыдущий месяц")}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
            <select className="calendar-month" id="picker-month" aria-label={uiText("Месяц")} />
            <input className="calendar-year" id="picker-year" required type="number" min="1" max="9999" inputMode="numeric" aria-label={uiText("Год")} />
            <button type="button" className="picker-icon" id="picker-next" aria-label={uiText("Следующий месяц")}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m10 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          <p className="picker-sr" id="picker-month-announcement" aria-live="polite" />
          <label className="field picker-direct-field" htmlFor="picker-direct">{uiText("Дата вручную")}<input id="picker-direct" type="text" inputMode="numeric" placeholder={uiText("ДД.ММ.ГГГГ")} maxLength={10} aria-describedby="picker-direct-hint" />
            <small id="picker-direct-hint">{uiText("Например, 25.12.2026. Или выберите день в календаре.")}</small>
          </label>
          <div id="picker-calendar" role="grid" aria-label={uiText("Календарь")} />
          <div className="picker-shortcuts">
            <button type="button" className="btn" data-relative-day="0">{uiText("Сегодня")}</button>
            <button type="button" className="btn" data-relative-day="1">{uiText("Завтра")}</button>
            <button type="button" className="btn" data-relative-day="7">{uiText("Через неделю")}</button>
          </div>
        </div>
        <div id="picker-time-panel" role="tabpanel" aria-labelledby="picker-time-tab" hidden>
          <p className="time-help">{uiText("Прокрутите часы и минуты. Выбранное время — в выделенной строке.")}</p>
          <div className="time-wheels" aria-label={uiText("Выбор времени")}>
            <div className="time-wheel-column">
              <span id="picker-hours-label">{uiText("Часы")}</span>
              <div className="time-wheel-frame">
                <div id="picker-hour-wheel" className="time-wheel" role="listbox" tabIndex={0} aria-labelledby="picker-hours-label" aria-describedby="picker-wheel-help" />
              </div>
            </div>
            <span className="wheel-colon" aria-hidden="true">
              :
            </span>
            <div className="time-wheel-column">
              <span id="picker-minutes-label">{uiText("Минуты")}</span>
              <div className="time-wheel-frame">
                <div id="picker-minute-wheel" className="time-wheel" role="listbox" tabIndex={0} aria-labelledby="picker-minutes-label" aria-describedby="picker-wheel-help" />
              </div>
            </div>
          </div>
          <p className="picker-sr" id="picker-wheel-help">{uiText("Прокрутите колонку или используйте стрелки вверх и вниз. Home — начало, End — конец.")}</p>
          <details id="picker-manual-time" className="manual-time">
            <summary>{uiText("Ввести время вручную")}</summary>
            <div className="manual-time-fields">
              <label className="field" htmlFor="picker-hour">{uiText("Часы")}<input id="picker-hour" type="number" min="0" max="23" step="1" inputMode="numeric" defaultValue="9" />
              </label>
              <label className="field" htmlFor="picker-minute">{uiText("Минуты")}<input id="picker-minute" type="number" min="0" max="59" step="1" inputMode="numeric" defaultValue="0" />
              </label>
            </div>
          </details>
          <div className="picker-shortcuts">
            <button type="button" className="btn" data-preset-time="08:00">{uiText("Утро · 08:00")}</button>
            <button type="button" className="btn" data-preset-time="13:00">{uiText("День · 13:00")}</button>
            <button type="button" className="btn" data-preset-time="19:00">{uiText("Вечер · 19:00")}</button>
          </div>
        </div>
        <p className="picker-preview" id="picker-preview" aria-live="polite" />
        <p className="picker-error" id="picker-error" role="alert" hidden />
        <div className="picker-actions">
          <button type="button" className="btn ghost" id="picker-clear">{uiText("Очистить")}</button>
          <button type="button" className="btn ghost" id="picker-cancel">{uiText("Отмена")}</button>
          <button type="button" className="btn primary" id="picker-apply">{uiText("Выбрать дату")}</button>
        </div>
      </dialog>
    </>
  );
}
