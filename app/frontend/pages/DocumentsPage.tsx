
export function DocumentsPage() {
  return (
    <>
      <section id="documents" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              АРХИВ И АНАЛИЗЫ
            </p>
            <h1>
              Документы
            </h1>
            <span className="subtle" id="docs-pet-name" />
          </div>
          <button className="btn primary" data-extra-modal="document" type="button">
            + Документ
          </button>
        </div>
        <div className="panel glass">
          <div className="panel-head">
            <h2>
              Файлы питомца
            </h2>
            <div className="chips" id="document-filters" />
          </div>
          <label className="field">
            Поиск документов
            <input type="search" id="document-search" placeholder="Название, категория или дата" />
          </label>
          <div id="document-list" className="record-list" />
        </div>
        <details className="secondary-details food-tools document-ai" id="document-recognition">
          <summary>
            Распознать текст с фото документа
          </summary>
          <div className="document-ai-body">
            <p className="document-ai-intro">
              Печатный текст на русском и английском. Фото обрабатывается на вашем устройстве и не отправляется сервисам распознавания. Рукописный текст пока не поддерживается. Даты, названия и дозировки сверяйте с оригиналом.
            </p>
            <label className="field" htmlFor="document-photo">
              {"Фото документа\n            "}
              <input id="document-photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="document-photo-hint" />
              <span className="document-ai-file-hint" id="document-photo-hint">
                Поддерживаются JPG, PNG и WebP (до 10 МБ).
              </span>
            </label>
            <label className="field" htmlFor="ocr-rotation">
              {"Поворот фото\n            "}
              <select id="ocr-rotation">
                <option value="0">
                  Без поворота
                </option>
                <option value="90">
                  90° по часовой стрелке
                </option>
                <option value="180">
                  180°
                </option>
                <option value="270">
                  90° против часовой стрелки
                </option>
              </select>
            </label>
            <div className="document-ai-actions">
              <button className="btn primary" id="recognize-button" type="button">
                Распознать текст
              </button>
              <button className="btn" id="copy-recognized" type="button" disabled>
                Скопировать текст
              </button>
            </div>
            <p className="document-ai-status" id="recognize-status" role="status" aria-live="polite" />
            <label className="field" htmlFor="recognized-text">
              {"Текст документа\n            "}
              <textarea id="recognized-text" rows={6} placeholder="Здесь появится распознанный текст документа" />
            </label>
          </div>
        </details>
      </section>
    </>
  );
}
