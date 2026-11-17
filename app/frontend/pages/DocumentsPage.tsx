export function DocumentsPage() {
  return (
    <div id="documents" role="tabpanel" aria-labelledby="health-documents-tab" hidden>
      <div className="documents-heading">
        <div>
          <h2>Документы питомца</h2>
          <p className="subtle">Паспорта, анализы и назначения · <span id="docs-pet-name" /></p>
        </div>
        <button className="btn primary" data-extra-modal="document" type="button">+ Добавить документ</button>
      </div>
      <div className="panel glass">
        <div className="chips document-categories" id="document-filters" aria-label="Категории документов" />
        <label className="field document-search">
          Поиск документов
          <input type="search" id="document-search" placeholder="Название, категория или дата" />
        </label>
        <div id="document-list" className="record-list" />
      </div>
      <button className="recognition-soon" id="document-recognition" type="button" disabled>
        <span className="recognition-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg>
        </span>
        <span><strong>Распознать текст с фото документа</strong><small>Скоро в PetCare</small></span>
        <span className="soon-badge">Скоро</span>
      </button>
    </div>
  );
}
