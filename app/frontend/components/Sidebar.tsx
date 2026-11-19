import { uiText } from '../i18n';

import { LockIcon } from './GuestPreview';

export function Sidebar() {
  return (
    <>
      <aside className="sidebar" aria-label={uiText("Навигация")}>
        <a className="brand" href="#/pets">
          <span className="brand-mark" aria-hidden="true" />
          petcare
          <span className="brand-dot">
            .
          </span>
        </a>
        <button className="all-pets" data-route="pets" data-guest-lock type="button">
          <svg aria-hidden="true">
            <use href="#paw" />
          </svg>
          {(uiText("Мои питомцы")+" ")}
          <span id="pet-count" />
          <LockIcon />
        </button>
        <div className="sidebar-caption">{uiText("КАБИНЕТ ПИТОМЦА")}</div>
        <div className="pet-account-switcher" id="pet-account-switcher">
          <button className="pet-account-button" id="pet-account-button" data-guest-lock type="button" aria-expanded="false" aria-controls="pet-account-panel">
            <span id="account-avatar" className="account-avatar" aria-hidden="true" />
            <span className="account-identity">
              <strong id="account-name">{uiText("Загрузка…")}</strong>
              <small>{uiText("Аккаунт питомца")}</small>
            </span>
            <span className="account-chevron" aria-hidden="true">
              ⌄
            </span>
            <LockIcon />
          </button>
          <div className="pet-account-panel" id="pet-account-panel" role="region" aria-label={uiText("Переключение аккаунтов питомцев")} hidden>
            <p className="account-panel-title">{uiText("Ваши питомцы")}</p>
            <div id="pet-account-list" />
            <button className="account-add" id="account-add" type="button">{"+ "+uiText("Добавить питомца")}</button>
          </div>
        </div>
        <nav className="nav" aria-label={uiText("Разделы кабинета")}>
          <a href="#health" data-page="health" data-guest-lock aria-label={uiText("Здоровье")}>
            <svg aria-hidden="true">
              <use href="#heart" />
            </svg>
            <span className="nav-label">{uiText("Здоровье")}</span>
            <LockIcon />
          </a>
          <a href="#nutrition" data-page="nutrition" data-guest-lock aria-label={uiText("Питание")}>
            <svg aria-hidden="true">
              <use href="#food" />
            </svg>
            <span className="nav-label">{uiText("Питание")}</span>
            <LockIcon />
          </a>
          <a href="#pets" data-page="pets" data-guest-lock className="mobile-pets" aria-label={uiText("Питомцы")}>
            <svg aria-hidden="true">
              <use href="#paw" />
            </svg>
            <span className="nav-label">{uiText("Питомцы")}</span>
            <LockIcon />
          </a>
          <a href="#care" data-page="care" data-guest-lock aria-label={uiText("Уход и события")}>
            <svg aria-hidden="true">
              <use href="#clock" />
            </svg>
            <span className="nav-label" data-mobile="Уход">{uiText("Уход и события")}</span>
            <LockIcon />
          </a>
          <a href="#match" data-page="match" data-guest-lock aria-label={uiText("Друзья")}>
            <svg aria-hidden="true">
              <use href="#spark" />
            </svg>
            <span className="nav-label" data-mobile="Друзья">{uiText("Друзья")}</span>
            <span id="match-nav-badge" className="nav-badge" hidden>
              0
            </span>
            <LockIcon />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <button id="profile-paw" className="owner-button" data-guest-lock aria-label={uiText("Профиль и настройки")} title={uiText("Профиль и настройки")} type="button">
            <span className="initial" id="owner-initial" />
            <LockIcon />
            <span>
              <b id="owner-name">{uiText("Профиль")}</b>
              <small id="owner-email">{uiText("Профиль и настройки")}</small>
            </span>
            <span aria-hidden="true">
              ↗
            </span>
          </button>
          <p className="local-note">{uiText("Данные синхронизируются с сервером (Cloud API)")}</p>
        </div>
      </aside>
    </>
  );
}
