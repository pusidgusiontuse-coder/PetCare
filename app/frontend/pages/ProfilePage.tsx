
export function ProfilePage() {
  return (
    <>
      <section id="profile" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              ЛИЧНЫЙ КАБИНЕТ
            </p>
            <h1>
              Профиль и настройки
            </h1>
          </div>
        </div>
        <div className="panel glass" id="account-panel">
          <h2>
            Ваш аккаунт
          </h2>
          <div id="person-profile" />
        </div>
        <div className="settings-list">
          <details className="settings-group" id="settings-person">
            <summary>
              <span>
                Личные данные
                <small>
                  Имя, почта и часовой пояс
                </small>
              </span>
            </summary>
            <div className="settings-body">
              <div className="api-actions">
                <button className="btn" data-extra-modal="profile" id="btn-account-settings" type="button">
                  Изменить данные
                </button>
                <button className="btn danger" id="api-logout" type="button">
                  Выйти из аккаунта
                </button>
                <button className="btn primary" id="btn-open-auth-modal" type="button" hidden>
                  Войти в аккаунт
                </button>
              </div>
            </div>
          </details>
          <details className="settings-group" id="settings-notifications">
            <summary>
              <span>
                Уведомления
                <small>
                  Расписание, тихие часы и способы доставки
                </small>
              </span>
            </summary>
            <div className="settings-body" id="settings-notifications-body">
              <div id="notification-settings" />
              <button className="btn" data-extra-modal="settings" type="button">
                Настроить уведомления
              </button>
              <div className="push-controls-row">
                <button className="btn tiny primary" id="enable-alerts" type="button">
                  🔔 Включить пуш-уведомления
                </button>
                <button className="btn tiny" id="test-push-btn" type="button">
                  Проверить уведомление
                </button>
                <span id="push-status-badge" className="push-status-pill off">
                  Уведомления выключены
                </span>
              </div>
            </div>
          </details>
          <details className="settings-group" id="settings-sharing">
            <summary>
              <span>
                Совместный доступ
                <small>
                  Участники ухода и приглашения
                </small>
              </span>
            </summary>
            <div className="settings-body" id="settings-sharing-body">
              <button className="btn" data-extra-modal="member" type="button">
                Добавить участника
              </button>
              <div id="family-list" className="record-list" />
            </div>
          </details>
          <details className="settings-group" id="settings-security">
            <summary>
              <span>
                Безопасность
                <small>
                  Пароль, почта, устройства и данные
                </small>
              </span>
            </summary>
            <div className="settings-body" id="settings-security-body" />
          </details>
          <details className="settings-group" id="settings-app">
            <summary>
              <span>
                Приложение
                <small>
                  Установка и возможности аккаунта
                </small>
              </span>
            </summary>
            <div className="settings-body" id="settings-app-body" />
          </details>
        </div>
        <div id="undo-area" />
      </section>
    </>
  );
}
