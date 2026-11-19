import { uiText } from '../i18n';

export function CarePage() {
  return (
    <>
      <section id="care" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">{uiText("РАСПИСАНИЕ ПРОЦЕДУР")}</p>
            <h1>{uiText("Уход и события")}</h1>
            <span className="subtle">{uiText("Время: Москва (UTC+3)")}</span>
          </div>
          <button className="btn primary" data-extra-modal="reminder" type="button">{"+ "+uiText("Напоминание")}</button>
        </div>
        <div className="panel glass">
          <div className="panel-head">
            <h2>{uiText("Расписание")}</h2>
            <div className="chips" id="care-filters" />
          </div>
          <div id="care-events" className="event-list" />
          <p className="notice">{uiText("События сохраняются на сервере и видны всем участникам совместного ухода.")}</p>
        </div>
        <details className="secondary-details">
          <summary>{uiText("История ухода и покупки")}</summary>
          <div className="grid2">
            <div className="panel glass">
              <div className="panel-head">
                <h2>{uiText("Выполненные и пропущенные")}</h2>
              </div>
              <div id="care-history" className="record-list" />
              <button id="care-history-more" className="btn tiny" type="button" hidden />
            </div>
            <div className="panel glass">
              <div className="panel-head">
                <h2>{uiText("Покупки")}</h2>
                <button className="btn tiny" data-extra-modal="shopping" type="button">{"+ "+uiText("Добавить")}</button>
              </div>
              <div id="shopping-list" className="record-list" />
            </div>
          </div>
        </details>
        <details className="secondary-details">
          <summary>{uiText("Клиника и дневник ухода")}</summary>
          <div className="panel glass" id="clinic-panel">
            <div className="panel-head">
              <h2>{uiText("Клиника и лечащий врач")}</h2>
              <button className="btn tiny" data-extra-modal="vet-contact" type="button">{uiText("Изменить")}</button>
            </div>
            <div id="vet-contact" />
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>{uiText("Дневник ухода")}</h2>
              <button className="btn" data-modal="activity" type="button">{"+ "+uiText("Записать действие")}</button>
            </div>
            <div id="care-activity" className="activity" />
          </div>
        </details>
      </section>
    </>
  );
}
