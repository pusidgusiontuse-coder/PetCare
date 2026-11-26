import { language, uiText } from '../i18n';
import { LanguagePicker } from '../i18n/LanguagePicker';
import { ThemePicker } from '../features/appearance/ThemePicker';
import { PremiumPlan } from '../features/billing/PremiumPlan';
import { BetaFeedbackButton } from '../components/BetaFeedback';
import { NotificationInbox } from '../features/notifications/NotificationInbox';

export function ProfilePage() {
  return (
    <section id="profile" className="section">
      <div className="topline"><h1>{uiText("Профиль и настройки")}</h1></div>

      <div className="panel glass profile-account" id="account-panel">
        <div id="person-profile" />
        <button className="btn" data-extra-modal="profile" id="btn-account-settings" type="button">{uiText("Редактировать профиль")}</button>
        <button className="btn primary" id="btn-open-auth-modal" type="button" hidden>{uiText("Войти в аккаунт")}</button>
      </div>

      <div className="panel language-panel"><LanguagePicker /></div>
      <ThemePicker />

      <div className="profile-install panel" id="settings-app">
        <div>
          <h2>{uiText("PetCare на главном экране")}</h2>
          <p id="install-summary">{uiText("Открывайте приложение прямо с экрана устройства.")}</p>
        </div>
        <button className="btn primary" id="install-petcare" type="button">{uiText("Установить PetCare")}</button>
      </div>

      <div className="settings-list" id="profile-settings" hidden>
        <NotificationInbox />
        <details className="settings-group" id="settings-notifications">
          <summary><span>{uiText("Уведомления")}<small>{uiText("Напоминания, почта и тихие часы")}</small></span></summary>
          <div className="settings-body" id="settings-notifications-body">
            <div id="notification-settings" />
            <button className="btn" data-extra-modal="settings" type="button">{uiText("Настроить расписание")}</button>
            <div className="push-controls-row">
              <button className="btn tiny primary" id="enable-alerts" type="button">{uiText("Включить уведомления в браузере")}</button>
              <button className="btn tiny" id="test-push-btn" type="button">{uiText("Проверить уведомление")}</button>
              <span id="push-status-badge" className="push-status-pill off">{uiText("Уведомления выключены")}</span>
            </div>
            <div className="background-push-setting">
              <label><input type="checkbox" id="background-push" defaultChecked />{uiText("Получать уведомления при закрытом сайте")}</label>
              <p id="background-push-status" role="status" />
              <button className="btn" id="subscribe-push" type="button" hidden>{language === 'en' ? 'Allow on this device' : 'Разрешить на этом устройстве'}</button>
            </div>
            <label><input type="checkbox" id="email-reminders" />{" "+uiText("Получать напоминания по почте")}</label>
          </div>
        </details>

        <details className="settings-group" id="settings-sharing">
          <summary><span>{uiText("Совместный уход")}<small>{uiText("Коды приглашения и участники")}</small></span></summary>
          <div className="settings-body" id="settings-sharing-body">
            <button className="btn" data-extra-modal="member" type="button">{uiText("Добавить участника")}</button>
            <div id="family-list" className="record-list" />
            <div id="server-members" />
          </div>
        </details>

        <details className="settings-group" id="settings-security">
          <summary><span>{uiText("Вход и безопасность")}<small>{uiText("Пароль, почта и устройства")}</small></span></summary>
          <div className="settings-body">
            <p id="email-status" hidden />
            <div className="profile-actions">
              <button type="button" className="btn" data-security="password_change">{uiText("Изменить пароль")}</button>
              <button type="button" className="btn" data-security="email_change">{uiText("Изменить почту")}</button>
              <button type="button" className="btn" data-security="verify_email">{uiText("Подтвердить почту")}</button>
              <button type="button" className="btn" id="sessions-open">{uiText("Устройства и входы")}</button>
              <button type="button" className="btn" id="logout-everywhere">{uiText("Выйти на всех устройствах")}</button>
            </div>
            <div id="session-list" />
          </div>
        </details>

        <PremiumPlan />
        <details className="settings-group" id="settings-data">
          <summary><span>{uiText("Данные аккаунта")}<small>{uiText("Выгрузка и удаление")}</small></span></summary>
          <div className="settings-body">
            <div className="profile-actions">
              <button type="button" className="btn" id="export-account">{uiText("Скачать свои данные")}</button>
              <button type="button" className="btn danger" data-security="delete_account">{uiText("Удалить аккаунт")}</button>
            </div>
          </div>
        </details>
      </div>
      <div className="panel profile-feedback">
        <div>
          <h2>{uiText('PetCare в бета-тесте')}</h2>
          <p>{uiText('Нашли ошибку или знаете, как сделать PetCare удобнее?')}</p>
        </div>
        <BetaFeedbackButton />
      </div>
      <button className="btn ghost profile-logout" id="api-logout" type="button">{uiText("Выйти из аккаунта")}</button>
      <div id="undo-area" />

      <dialog id="install-dialog" className="install-dialog" aria-labelledby="install-title">
        <div className="panel">
          <h2 id="install-title">{uiText("Установка PetCare")}</h2>
          <fieldset className="install-platform" aria-label={uiText("Устройство")}>
            <label><input type="radio" name="install-platform" value="android" aria-controls="install-android" /><span>Android</span></label>
            <label><input type="radio" name="install-platform" value="iphone" aria-controls="install-iphone" defaultChecked /><span>iPhone</span></label>
          </fieldset>
          <div className="install-content" id="install-android" hidden>
            <div className="install-demo" aria-hidden="true">
              <img className="install-icon" src="/static/icon-192.png" alt="" width={64} height={64} />
            </div>
            <p className="install-note" id="install-apk-status" role="status">{uiText("Проверяем доступность APK…")}</p>
            <a className="btn primary" id="install-apk" href="/static/petcare.apk" download="PetCare.apk" hidden>{uiText("Скачать APK")}</a>
            <button className="btn" id="install-web" type="button" hidden>{uiText("Установить веб-версию")}</button>
            <p className="install-note" id="install-web-help">{uiText("Веб-версия в Chrome: меню ⋮ → «Добавить на главный экран».")}</p>
          </div>
          <div className="install-content" id="install-iphone">
            <div className="install-demo" aria-hidden="true">
              <div className="install-device">
                <span className="install-menu">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3m-4 4 4-4 4 4M8 10H5v11h14V10h-3" /></svg>
                </span>
                <span className="install-row">{uiText("На экран «Домой")+"»"}</span>
                <img className="install-icon" src="/static/icon-192.png" alt="" width={48} height={48} />
              </div>
            </div>
            <ol className="install-steps">
              <li>{uiText("Откройте PetCare в Safari и нажмите «Поделиться» в меню браузера.")}</li>
              <li>{uiText("Прокрутите меню до пункта «На экран „Домой“» и выберите его.")}</li>
              <li>{uiText("Если есть переключатель «Открыть как веб-приложение», включите его. Нажмите «Добавить».")}</li>
            </ol>
          </div>
          <button className="btn" type="button" id="install-close">{uiText("Готово")}</button>
        </div>
      </dialog>
    </section>
  );
}
