
export function CarePage() {
  return (
    <>
      <section id="care" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              РАСПИСАНИЕ ПРОЦЕДУР
            </p>
            <h1>
              Уход и события
            </h1>
            <span className="subtle">
              Время: Москва (UTC+3)
            </span>
          </div>
          <button className="btn primary" data-extra-modal="reminder" type="button">
            + Напоминание
          </button>
        </div>
        <div className="panel glass">
          <div className="panel-head">
            <h2>
              Расписание
            </h2>
            <div className="chips" id="care-filters" />
          </div>
          <div id="care-events" className="event-list" />
          <p className="notice">
            События сохраняются на сервере и видны всем участникам совместного ухода.
          </p>
        </div>
        <details className="secondary-details">
          <summary>
            История ухода и покупки
          </summary>
          <div className="grid2">
            <div className="panel glass">
              <div className="panel-head">
                <h2>
                  Выполненные и пропущенные
                </h2>
              </div>
              <div id="care-history" className="record-list" />
              <button id="care-history-more" className="btn tiny" type="button" hidden />
            </div>
            <div className="panel glass">
              <div className="panel-head">
                <h2>
                  Покупки
                </h2>
                <button className="btn tiny" data-extra-modal="shopping" type="button">
                  + Добавить
                </button>
              </div>
              <div id="shopping-list" className="record-list" />
            </div>
          </div>
        </details>
        <details className="secondary-details">
          <summary>
            Клиника и дневник ухода
          </summary>
          <div className="panel glass" id="clinic-panel">
            <div className="panel-head">
              <h2>
                Клиника и лечащий врач
              </h2>
              <button className="btn tiny" data-extra-modal="vet-contact" type="button">
                Изменить
              </button>
            </div>
            <div id="vet-contact" />
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>
                Дневник ухода
              </h2>
              <button className="btn" data-modal="activity" type="button">
                + Записать действие
              </button>
            </div>
            <div id="care-activity" className="activity" />
          </div>
        </details>
      </section>
    </>
  );
}
