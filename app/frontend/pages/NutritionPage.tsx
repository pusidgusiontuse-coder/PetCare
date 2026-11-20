import { uiText } from '../i18n';
import { NutritionTools } from '../features/nutrition/NutritionTools';

export function NutritionPage() {
  return (
    <>
      <section id="nutrition" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">{uiText("РАЦИОН И ПИТАНИЕ")}</p>
            <h1>{uiText("Питание")}</h1>
            <span className="subtle" id="nutrition-pet-name" />
          </div>
          <button className="btn primary" data-extra-modal="meal-plan" type="button">{uiText("Настроить кормление")}</button>
        </div>
        <div className="grid2">
          <div className="panel glass">
            <div className="panel-head">
              <h2>{uiText("Напоминания о еде")}</h2>
              <span className="small" id="feeding-day" />
            </div>
            <div id="feeding-reminders" className="event-list" />
            <p className="notice">{uiText("Синхронизируется со всеми участниками ухода. Отметки сохраняются на сервере.")}</p>
          </div>
          <div className="panel glass feeding-history-summary">
            <button type="button" id="feeding-history-open" aria-haspopup="dialog">
              <span className="feeding-history-heading">
                <strong>{uiText("История кормлений")}</strong><span aria-hidden="true">↗</span>
              </span>
              <span id="feeding-history-preview" />
              <span className="feeding-history-link">{uiText("Открыть всю историю")}</span>
            </button>
          </div>
        </div>
        <dialog id="feeding-history-dialog" aria-labelledby="feeding-history-title">
          <form method="dialog"><button className="modal-close" type="submit" aria-label={uiText("Закрыть")} /></form>
          <h2 id="feeding-history-title">{uiText("История кормлений")}</h2>
          <div id="feeding-history" className="record-list" />
        </dialog>
        <NutritionTools />
      </section>
    </>
  );
}
