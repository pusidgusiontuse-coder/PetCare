
export function PetsPage() {
  return (
    <>
      <section id="pets" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              ВАША СЕМЬЯ
            </p>
            <h1>
              Мои питомцы
            </h1>
            <p className="page-description">
              Всё важное о каждом — в своём кабинете с поддержкой совместного ухода по коду.
            </p>
          </div>
          <div className="account-header-actions">
            <button className="btn primary" data-modal="pet" type="button">
              + Добавить питомца
            </button>
          </div>
        </div>
        <section id="today-panel" className="panel glass" aria-labelledby="today-heading" hidden>
          <h2 id="today-heading">
            Сегодня
          </h2>
          <div id="today-overview" />
        </section>
        <div id="pet-cards" className="pet-grid" />
        <div className="directory-note">
          <svg aria-hidden="true">
            <use href="#heart" />
          </svg>
          <div>
            <b>
              Забота начинается с мелочей
            </b>
            <p>
              Откройте карточку питомца, скопируйте код для совместного ухода или переключите кабинет в боковой панели.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
