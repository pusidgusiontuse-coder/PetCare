import { uiText } from '../i18n';
export function DocumentsPage() {
  return (
    <div id="documents" role="tabpanel" aria-labelledby="health-documents-tab" hidden>
      <div className="documents-heading">
        <div>
          <h2>{uiText("Документы питомца")}</h2>
          <p className="subtle">{uiText("Паспорта, анализы и назначения ·")+" "}<span id="docs-pet-name" /></p>
        </div>
        <button className="btn primary" data-extra-modal="document" type="button">{"+ "+uiText("Добавить документ")}</button>
      </div>
      <div className="panel glass">
        <div className="chips document-categories" id="document-filters" aria-label={uiText("Категории документов")} />
        <label className="field document-search">{uiText("Поиск документов")}<input type="search" id="document-search" placeholder={uiText("Название, категория или дата")} />
        </label>
        <div id="document-list" className="record-list" />
      </div>
      <button className="recognition-soon" id="document-recognition" type="button" disabled>
        <span className="recognition-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg>
        </span>
        <span><strong>{uiText("Распознать текст с фото документа")}</strong><small>{uiText("Скоро в PetCare")}</small></span>
        <span className="soon-badge">{uiText("Скоро")}</span>
      </button>
    </div>
  );
}
