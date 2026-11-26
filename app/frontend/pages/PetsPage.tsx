import type { ReactNode } from 'react';
import { uiText } from '../i18n';

export function PetsPage({ greeting }: { greeting: ReactNode }) {
  return (
    <>
      <section id="pets" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">{uiText("ВАША СЕМЬЯ")}</p>
            <h1>{uiText("Мои питомцы")}</h1>
            <p className="page-description">{uiText("Всё важное о каждом — в своём кабинете с поддержкой совместного ухода по коду.")}</p>
          </div>
          <div className="account-header-actions">
            <button className="btn primary" data-modal="pet" type="button">{"+ "+uiText("Добавить питомца")}</button>
          </div>
        </div>
        {greeting}
        <div id="pet-cards" className="pet-grid" />
        <section id="today-panel" className="panel glass" aria-labelledby="today-heading" hidden>
          <h2 id="today-heading">{uiText("Сегодня")}</h2>
          <div id="today-overview" />
        </section>
        <details id="tomorrow-panel" className="panel tomorrow-panel"><summary><span><strong>{uiText("Завтра")}</strong><small id="tomorrow-summary" /></span><span aria-hidden="true">↗</span></summary><div id="tomorrow-overview" /></details>
        <div className="directory-note">
          <svg aria-hidden="true">
            <use href="#heart" />
          </svg>
          <div>
            <b>{uiText("Забота начинается с мелочей")}</b>
            <p>{uiText("Откройте карточку питомца, скопируйте код для совместного ухода или переключите кабинет в боковой панели.")}</p>
          </div>
        </div>
      </section>
    </>
  );
}
