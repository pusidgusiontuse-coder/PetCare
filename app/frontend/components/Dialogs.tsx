
export function Dialogs() {
  return (
    <>
      <dialog id="editor" aria-labelledby="editor-title" aria-describedby="editor-context">
        <button type="button" id="close-editor" className="modal-close" aria-label="Закрыть карточку или форму" />
        <form id="editor-form">
          <h2 id="editor-title" />
          <p id="editor-context" className="small" />
          <p id="editor-error" role="alert" tabIndex={-1} hidden />
          <div id="editor-fields" className="form-grid" />
          <div className="form-actions">
            <button type="button" className="btn ghost" id="cancel-editor">
              Отмена
            </button>
            <button className="btn primary" type="submit">
              Сохранить
            </button>
          </div>
        </form>
      </dialog>
      <dialog id="auth-dialog" className="auth-dialog" aria-labelledby="auth-dialog-title">
        <button type="button" id="close-auth-dialog" className="modal-close" aria-label="Закрыть окно входа" />
        <div className="auth-header">
          <div className="auth-logo">
            <span className="brand-mark">
              <svg aria-hidden="true">
                <use href="#paw" />
              </svg>
            </span>
            petcare
            <span className="brand-dot">
              .
            </span>
          </div>
          <h2 id="auth-dialog-title" className="auth-title">
            Вход в PetCare
          </h2>
          <p className="auth-sub">
            Единый сервис заботы о здоровье, питании и совместном уходе за питомцами
          </p>
        </div>
        <div className="auth-tabs" role="tablist">
          <button type="button" className="auth-tab active" id="tab-login" role="tab" aria-selected="true">
            Вход
          </button>
          <button type="button" className="auth-tab" id="tab-register" role="tab" aria-selected="false">
            Регистрация
          </button>
        </div>
        <div id="auth-error" className="auth-error" role="alert" tabIndex={-1} hidden />
        <form id="auth-form" className="auth-form">
          <div className="field" id="auth-name-field" hidden>
            <label htmlFor="auth-name">
              Ваше имя
            </label>
            <input type="text" id="auth-name" name="name" autoComplete="name" placeholder="Илья Иванов" />
          </div>
          <div className="field">
            <label htmlFor="auth-email">
              Электронная почта
            </label>
            <input type="text" id="auth-email" name="username" spellCheck={false} required placeholder="name@example.com" autoComplete="username" />
          </div>
          <div className="field">
            <label htmlFor="auth-password">
              Пароль
            </label>
            <input type="password" id="auth-password" name="password" required minLength={8} placeholder="••••••••" autoComplete="current-password" />
          </div>
          <button type="submit" className="btn primary auth-submit" id="auth-submit-btn">
            Войти в аккаунт
          </button>
        </form>
      </dialog>
      <dialog id="temporal-picker" aria-labelledby="picker-title" aria-describedby="picker-context">
        <div className="picker-heading">
          <button type="button" className="modal-close" id="picker-close" aria-label="Закрыть выбор даты и времени" />
          <h2 id="picker-title">
            Выбрать дату
          </h2>
          <p className="picker-context" id="picker-context" />
        </div>
        <div className="picker-tabs" role="tablist" aria-label="Дата и время" id="picker-tabs">
          <button type="button" role="tab" id="picker-date-tab" aria-controls="picker-date-panel" aria-selected="true">
            Дата
          </button>
          <button type="button" role="tab" id="picker-time-tab" aria-controls="picker-time-panel" aria-selected="false" tabIndex={-1}>
            Время
          </button>
        </div>
        <div id="picker-date-panel" role="tabpanel" aria-labelledby="picker-date-tab">
          <div className="calendar-toolbar">
            <button type="button" className="picker-icon" id="picker-prev" aria-label="Предыдущий месяц">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
            <select className="calendar-month" id="picker-month" aria-label="Месяц" />
            <input className="calendar-year" id="picker-year" required type="number" min="1" max="9999" inputMode="numeric" aria-label="Год" />
            <button type="button" className="picker-icon" id="picker-next" aria-label="Следующий месяц">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m10 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          <p className="picker-sr" id="picker-month-announcement" aria-live="polite" />
          <label className="field picker-direct-field" htmlFor="picker-direct">
            Дата вручную
            <input id="picker-direct" type="text" inputMode="numeric" placeholder="ДД.ММ.ГГГГ" maxLength={10} aria-describedby="picker-direct-hint" />
            <small id="picker-direct-hint">
              Например, 25.12.2026. Или выберите день в календаре.
            </small>
          </label>
          <div id="picker-calendar" role="grid" aria-label="Календарь" />
          <div className="picker-shortcuts">
            <button type="button" className="btn" data-relative-day="0">
              Сегодня
            </button>
            <button type="button" className="btn" data-relative-day="1">
              Завтра
            </button>
            <button type="button" className="btn" data-relative-day="7">
              Через неделю
            </button>
          </div>
        </div>
        <div id="picker-time-panel" role="tabpanel" aria-labelledby="picker-time-tab" hidden>
          <p className="time-help">
            Прокрутите часы и минуты. Выбранное время — в выделенной строке.
          </p>
          <div className="time-wheels" aria-label="Выбор времени">
            <div className="time-wheel-column">
              <span id="picker-hours-label">
                Часы
              </span>
              <div className="time-wheel-frame">
                <div id="picker-hour-wheel" className="time-wheel" role="listbox" tabIndex={0} aria-labelledby="picker-hours-label" aria-describedby="picker-wheel-help" />
              </div>
            </div>
            <span className="wheel-colon" aria-hidden="true">
              :
            </span>
            <div className="time-wheel-column">
              <span id="picker-minutes-label">
                Минуты
              </span>
              <div className="time-wheel-frame">
                <div id="picker-minute-wheel" className="time-wheel" role="listbox" tabIndex={0} aria-labelledby="picker-minutes-label" aria-describedby="picker-wheel-help" />
              </div>
            </div>
          </div>
          <p className="picker-sr" id="picker-wheel-help">
            Прокрутите колонку или используйте стрелки вверх и вниз. Home — начало, End — конец.
          </p>
          <details id="picker-manual-time" className="manual-time">
            <summary>
              Ввести время вручную
            </summary>
            <div className="manual-time-fields">
              <label className="field" htmlFor="picker-hour">
                Часы
                <input id="picker-hour" type="number" min="0" max="23" step="1" inputMode="numeric" defaultValue="9" />
              </label>
              <label className="field" htmlFor="picker-minute">
                Минуты
                <input id="picker-minute" type="number" min="0" max="59" step="1" inputMode="numeric" defaultValue="0" />
              </label>
            </div>
          </details>
          <div className="picker-shortcuts">
            <button type="button" className="btn" data-preset-time="08:00">
              Утро · 08:00
            </button>
            <button type="button" className="btn" data-preset-time="13:00">
              День · 13:00
            </button>
            <button type="button" className="btn" data-preset-time="19:00">
              Вечер · 19:00
            </button>
          </div>
        </div>
        <p className="picker-preview" id="picker-preview" aria-live="polite" />
        <p className="picker-error" id="picker-error" role="alert" hidden />
        <div className="picker-actions">
          <button type="button" className="btn ghost" id="picker-clear">
            Очистить
          </button>
          <button type="button" className="btn ghost" id="picker-cancel">
            Отмена
          </button>
          <button type="button" className="btn primary" id="picker-apply">
            Выбрать дату
          </button>
        </div>
      </dialog>
    </>
  );
}
