import { NutritionTools } from '../features/nutrition/NutritionTools';

export function NutritionPage() {
  return (
    <>
      <section id="nutrition" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              РАЦИОН И ПИТАНИЕ
            </p>
            <h1>
              Питание
            </h1>
            <span className="subtle" id="nutrition-pet-name" />
          </div>
          <div className="row nutrition-actions">
            <button className="btn primary" data-extra-modal="meal-plan" type="button">
              Настроить кормления
            </button>
            <button className="btn" data-modal="nutrition" id="nutrition-add-food" type="button">
              + Добавить корм
            </button>
          </div>
        </div>
        <div className="grid2">
          <div className="panel glass">
            <div className="panel-head">
              <h2>
                Напоминания о еде
              </h2>
              <span className="small" id="feeding-day" />
            </div>
            <div id="feeding-reminders" className="event-list" />
            <p className="notice">
              Синхронизируется со всеми участниками ухода. Отметки сохраняются на сервере.
            </p>
          </div>
          <div className="panel glass">
            <div className="panel-head">
              <h2>
                История кормлений
              </h2>
              <button className="btn tiny" data-extra-modal="feeding-log" type="button">
                + Записать
              </button>
            </div>
            <div id="feeding-history" className="record-list" />
          </div>
        </div>
        <NutritionTools />
      </section>
    </>
  );
}
