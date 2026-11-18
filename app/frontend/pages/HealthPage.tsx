import { DocumentsPage } from './DocumentsPage';
export function HealthPage() {
  return (
    <>
      <section id="health" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              МЕДИЦИНСКАЯ КАРТА
            </p>
            <h1>
              Здоровье
            </h1>
            <span className="subtle" id="health-pet-name" />
          </div>
          <button className="btn primary" data-modal="health" type="button">
            + Добавить запись
          </button>
        </div>
        <div className="health-tabs" role="tablist" aria-label="Разделы здоровья">
          <button type="button" id="health-overview-tab" role="tab" aria-selected="true" aria-controls="health-overview-panel" data-health-tab="overview">Медкарта</button>
          <button type="button" id="health-documents-tab" role="tab" aria-selected="false" aria-controls="documents" data-health-tab="documents" tabIndex={-1}>Документы</button>
        </div>
        <div id="health-overview-panel" role="tabpanel" aria-labelledby="health-overview-tab">
          <details className="pet-profile-panel" id="health-pet-profile">
            <summary>
              <span className="profile-pet-avatar" id="health-profile-avatar" aria-hidden="true" />
              <span className="profile-pet-heading">
                <span className="eyebrow">
                  КАРТОЧКА ПИТОМЦА
                </span>
                <strong id="health-profile-name" />
                <small id="health-profile-meta" />
              </span>
              <span className="small">
                Изменить
              </span>
              <span className="profile-disclosure-arrow" aria-hidden="true" />
            </summary>
            <form id="health-pet-form" aria-label="Карточка питомца">
              <div className="form-grid pet-profile-fields" id="health-profile-fields" />
              <div className="profile-form-actions">
                <button className="btn primary" type="submit">
                  Сохранить карточку
                </button>
                <button className="btn ghost" type="button" id="health-profile-reset">
                  Отменить изменения
                </button>
                <p id="health-profile-feedback" tabIndex={-1} role="status" aria-live="polite" />
              </div>
            </form>
            <div className="pet-appearance">
              <h3>
                Внешний вид карточки
              </h3>
              <div id="avatar-preview" />
              <button className="btn" data-extra-modal="avatar" type="button">
                Изменить аватар питомца
              </button>
            </div>
          </details>
          <div className="panel glass">
            <div className="panel-head">
              <h2>
                Вес питомца
              </h2>
              <button className="btn tiny" data-modal="weight" type="button">
                + Измерение
              </button>
            </div>
            <div className="row space">
              <div id="last-weight" className="pet-name" />
              <select id="weight-period" aria-label="Период графика" defaultValue="365">
                <option value="30">
                  30 дней
                </option>
                <option value="90">
                  90 дней
                </option>
                <option value="365">
                  Год
                </option>
                <option value="all">
                  Всё время
                </option>
              </select>
            </div>
            <div id="weight-chart" className="chart-wrap" />
            <div id="weight-history" className="small" />
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>
                История здоровья
              </h2>
              <div className="chips" id="health-filters" />
            </div>
            <div id="health-records" className="record-list" />
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>
                Назначения препаратов
              </h2>
              <button className="btn tiny" data-modal="prescription" type="button">
                + Назначение
              </button>
            </div>
            <div id="prescriptions" className="record-list" />
          </div>
        </div>
        <DocumentsPage />
      </section>
    </>
  );
}
