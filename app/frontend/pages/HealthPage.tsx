import { uiText } from '../i18n';
import { DocumentsPage } from './DocumentsPage';
export function HealthPage() {
  return (
    <>
      <section id="health" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">{uiText("МЕДИЦИНСКАЯ КАРТА")}</p>
            <h1>{uiText("Здоровье")}</h1>
            <span className="subtle" id="health-pet-name" />
          </div>
          <button className="btn primary" data-modal="health" type="button">{"+ "+uiText("Добавить запись")}</button>
        </div>
        <div className="health-tabs" role="tablist" aria-label={uiText("Разделы здоровья")}>
          <button type="button" id="health-overview-tab" role="tab" aria-selected="true" aria-controls="health-overview-panel" data-health-tab="overview">{uiText("Медкарта")}</button>
          <button type="button" id="health-documents-tab" role="tab" aria-selected="false" aria-controls="documents" data-health-tab="documents" tabIndex={-1}>{uiText("Документы")}</button>
        </div>
        <div id="health-overview-panel" role="tabpanel" aria-labelledby="health-overview-tab">
          <div className="panel glass">
            <div className="panel-head">
              <h2>{uiText("Вес питомца")}</h2>
              <button className="btn tiny" data-modal="weight" type="button">{"+ "+uiText("Измерение")}</button>
            </div>
            <div className="row space">
              <div id="last-weight" className="pet-name" />
              <select id="weight-period" aria-label={uiText("Период графика")} defaultValue="365">
                <option value="30">{uiText("30 дней")}</option>
                <option value="90">{uiText("90 дней")}</option>
                <option value="365">{uiText("Год")}</option>
                <option value="all">{uiText("Всё время")}</option>
              </select>
            </div>
            <div id="weight-chart" className="chart-wrap" />
            <div id="weight-history" className="small" />
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>{uiText("История здоровья")}</h2>
              <div className="chips" id="health-filters" />
            </div>
            <div id="health-records" className="record-list" />
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>{uiText("Назначения препаратов")}</h2>
              <button className="btn tiny" data-modal="prescription" type="button">{"+ "+uiText("Назначение")}</button>
            </div>
            <div id="prescriptions" className="record-list" />
          </div>
        </div>
        <DocumentsPage />
      </section>
    </>
  );
}
