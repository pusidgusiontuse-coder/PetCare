
export function Sidebar() {
  return (
    <>
      <aside className="sidebar" aria-label="Навигация">
        <a className="brand" href="#/pets">
          <span className="brand-mark">
            <svg aria-hidden="true">
              <use href="#paw" />
            </svg>
          </span>
          petcare
          <span className="brand-dot">
            .
          </span>
        </a>
        <button className="all-pets" data-route="pets" type="button">
          <svg aria-hidden="true">
            <use href="#paw" />
          </svg>
          {"Мои питомцы "}
          <span id="pet-count" />
        </button>
        <div className="sidebar-caption">
          КАБИНЕТ ПИТОМЦА
        </div>
        <div className="pet-account-switcher" id="pet-account-switcher">
          <button className="pet-account-button" id="pet-account-button" type="button" aria-expanded="false" aria-controls="pet-account-panel">
            <span id="account-avatar" className="account-avatar" aria-hidden="true" />
            <span className="account-identity">
              <strong id="account-name">
                Загрузка…
              </strong>
              <small>
                Аккаунт питомца
              </small>
            </span>
            <span className="account-chevron" aria-hidden="true">
              ⌄
            </span>
          </button>
          <div className="pet-account-panel" id="pet-account-panel" role="region" aria-label="Переключение аккаунтов питомцев" hidden>
            <p className="account-panel-title">
              Ваши питомцы
            </p>
            <div id="pet-account-list" />
            <button className="account-add" id="account-add" type="button">
              + Добавить питомца
            </button>
          </div>
        </div>
        <nav className="nav" aria-label="Разделы кабинета">
          <a href="#health" data-page="health" aria-label="Здоровье">
            <svg aria-hidden="true">
              <use href="#heart" />
            </svg>
            <span className="nav-label">
              Здоровье
            </span>
          </a>
          <a href="#nutrition" data-page="nutrition" aria-label="Питание">
            <svg aria-hidden="true">
              <use href="#food" />
            </svg>
            <span className="nav-label">
              Питание
            </span>
          </a>
          <a href="#pets" data-page="pets" className="mobile-pets" aria-label="Питомцы">
            <svg aria-hidden="true">
              <use href="#paw" />
            </svg>
            <span className="nav-label">
              Питомцы
            </span>
          </a>
          <a href="#care" data-page="care" aria-label="Уход и события">
            <svg aria-hidden="true">
              <use href="#clock" />
            </svg>
            <span className="nav-label" data-mobile="Уход">
              Уход и события
            </span>
          </a>
          <a href="#match" data-page="match" aria-label="Друзья">
            <svg aria-hidden="true">
              <use href="#spark" />
            </svg>
            <span className="nav-label" data-mobile="Друзья">
              Друзья
            </span>
            <span id="match-nav-badge" className="nav-badge" hidden>
              0
            </span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <button id="profile-paw" className="owner-button" aria-label="Профиль и настройки" title="Профиль и настройки" type="button">
            <span className="initial" id="owner-initial">
              И
            </span>
            <span>
              <b id="owner-name">
                Илья
              </b>
              <small id="owner-email">
                Профиль и настройки
              </small>
            </span>
            <span aria-hidden="true">
              ↗
            </span>
          </button>
          <p className="local-note">
            Данные синхронизируются с сервером (Cloud API)
          </p>
        </div>
      </aside>
    </>
  );
}
