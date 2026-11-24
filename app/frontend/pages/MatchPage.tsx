import { uiText } from '../i18n';
import { ProfileGallery } from '../components/ProfileGallery';

export function MatchPage() {
  return (
    <>
      <section id="match" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">{uiText("СООБЩЕСТВО ХВОСТАТЫХ")}</p>
            <h1>{uiText("Поиск друзей")}</h1>
            <span className="subtle" id="match-pet-subtitle" />
          </div>
          <button className="btn primary" id="btn-open-my-match-form" type="button">{uiText("Анкета питомца")}</button>
        </div>
        <div className="match-context-bar" id="match-context-bar" />
        <div className="match-mode-tabs" role="tablist" aria-label={uiText("Разделы поиска друзей")}>
          <button type="button" className="match-mode-tab active" data-match-tab="discover" role="tab" aria-selected="true">
            <span>{uiText("Анкеты питомцев")}</span>
            <span className="match-tab-count" id="match-discover-count">
              0
            </span>
          </button>
          <button type="button" className="match-mode-tab" data-match-tab="incoming" role="tab" aria-selected="false">
            <span>{uiText("Вас лайкнули")}</span>
            <span className="match-tab-count hot" id="match-incoming-count">
              0
            </span>
          </button>
          <button type="button" className="match-mode-tab" data-match-tab="liked" role="tab" aria-selected="false">
            <span>{uiText("Друзья")}</span>
            <span className="match-tab-count" id="match-liked-count">
              0
            </span>
          </button>
          <button type="button" className="match-mode-tab" data-match-tab="profile" role="tab" aria-selected="false">
            <span>{uiText("Анкета питомца")}</span>
          </button>
        </div>
        <div id="match-pane-discover">
          <div className="match-deck-layout" id="match-deck-container" />
        </div>
        <div id="match-pane-incoming" hidden>
          <div id="match-incoming-inspect" style={{"marginBottom": "24px"}} hidden />
          <div className="panel glass">
            <div className="panel-head">
              <div>
                <h2>{uiText("Кому понравился ваш питомец")}</h2>
                <p className="small" style={{"margin": "4px 0 0"}}>{uiText("Посмотрите анкету питомца, ответьте лайком или скопируйте контакты хозяина прямо из карточки")}</p>
              </div>
            </div>
            <div id="match-incoming-list" className="match-cards-grid" />
          </div>
        </div>
        <div id="match-pane-liked" hidden>
          <div className="panel glass">
            <div className="panel-head">
              <div>
                <h2>{uiText("Друзья")}</h2>
                <p className="small" style={{"margin": "4px 0 0"}}>{uiText("Питомцы, которых вы отметили лайком, и контакты их хозяев")}</p>
              </div>
            </div>
            <div id="match-liked-list" className="match-cards-grid" />
          </div>
        </div>
        <div id="match-pane-profile" hidden>
          <div className="panel glass">
            <div className="panel-head">
              <div>
                <h2 id="match-form-heading">{uiText("Анкета питомца")}</h2>
                <p className="small" style={{"margin": "4px 0 0"}}>{uiText("Заполните анкету для активного питомца, чтобы другие владельцы могли найти вас")}</p>
              </div>
            </div>
            <form id="match-profile-form" className="form-grid">
              <label className="field">
                {(uiText("Имя питомца")+"\n              ")}
                <input name="name" type="text" required placeholder={uiText("Например: Барсик")} />
              </label>
              <label className="field">
                {(uiText("Вид животного")+"\n              ")}
                <input name="species" type="text" required placeholder={uiText("Кот, Кошка, Собака…")} />
              </label>
              <label className="field">
                {(uiText("Порода")+"\n              ")}
                <input name="breed" type="text" required placeholder={uiText("Британская короткошёрстная, Овчарка…")} />
              </label>
              <label className="field">
                {(uiText("Дата рождения")+"\n              ")}
                <input name="birth_date" type="date" />
              </label>
              <label className="field">
                {(uiText("Пол")+"\n              ")}
                <select name="sex">
                  <option value="Неизвестно">{uiText("Не указано")}</option>
                  <option value="Самец">{uiText("Самец")}</option>
                  <option value="Самка">{uiText("Самка")}</option>
                </select>
              </label>
              <label className="field">
                {(uiText("Прививки")+"\n              ")}
                <select name="vaccinated">
                  <option value="Не указано">{uiText("Не указано")}</option>
                  <option value="Да, все по возрасту">{uiText("Да, все по возрасту")}</option>
                  <option value="Частично (по графику)">{uiText("Частично (по графику)")}</option>
                  <option value="Нет прививок">{uiText("Нет прививок")}</option>
                </select>
              </label>
              <fieldset className="purpose-field sterilization-field full"><legend>{uiText("Стерилизация / кастрация")}</legend><div className="purpose-options binary-options">
                <label className="purpose-option"><input type="radio" name="sterilized" value="Да" /><span><strong>{uiText("Да")}</strong><small>{uiText("Проведена")}</small></span><span className="purpose-check" aria-hidden="true" /></label>
                <label className="purpose-option"><input type="radio" name="sterilized" value="Нет" defaultChecked /><span><strong>{uiText("Нет")}</strong><small>{uiText("Не проводилась")}</small></span><span className="purpose-check" aria-hidden="true" /></label>
              </div></fieldset>
              <fieldset className="purpose-field full">
                <legend>{uiText("Кого ищем?")}</legend>
                <p>{uiText("Выберите главную цель знакомства")}</p>
                <div className="purpose-options">
                  <label className="purpose-option">
                    <input type="radio" name="purpose" value="Совместные прогулки и игры" defaultChecked />
                    <span className="purpose-icon" aria-hidden="true"><svg><use href="#paw" /></svg></span>
                    <span><strong>{uiText("Гулять и играть")}</strong><small>{uiText("Компания для прогулок и новых открытий")}</small></span>
                    <span className="purpose-check" aria-hidden="true" />
                  </label>
                  <label className="purpose-option">
                    <input type="radio" name="purpose" value="Поиск компании по породе" />
                    <span className="purpose-icon" aria-hidden="true"><svg><use href="#spark" /></svg></span>
                    <span><strong>{uiText("Найти свою компанию")}</strong><small>{uiText("Знакомства с питомцами той же породы")}</small></span>
                    <span className="purpose-check" aria-hidden="true" />
                  </label>
                  <label className="purpose-option">
                    <input type="radio" name="purpose" value="Вязка / продолжение рода" />
                    <span className="purpose-icon" aria-hidden="true"><svg><use href="#heart" /></svg></span>
                    <span><strong>{uiText("Найти пару")}</strong><small>{uiText("Партнёр для продолжения рода")}</small></span>
                    <span className="purpose-check" aria-hidden="true" />
                  </label>
                </div>
              </fieldset>
              <label className="field">
                {(uiText("Город и район")+"\n              ")}
                <input name="city" type="text" placeholder={uiText("Например: Москва, Сокольники")} />
              </label>
              <label className="field">
                {(uiText("Имя хозяина")+"\n              ")}
                <input name="owner_name" type="text" required placeholder={uiText("Ваше имя")} />
              </label>
              <label className="field full">
                {(uiText("Контакты хозяина для связи (обязательно)")+"\n              ")}
                <input name="owner_contact" type="text" required placeholder={uiText("Telegram: @username, телефон +7 (999) 000-00-00 или WhatsApp")} />
              </label>
              <label className="field full">
                {(uiText("О питомце (характер, привычки, кого ищете)")+"\n              ")}
                <textarea name="bio" rows={4} placeholder={uiText("Расскажите о характере питомца и кого ищете для прогулок или общения")} />
              </label>
              <ProfileGallery />
              <label className="full">
                <input name="is_published" type="checkbox" />
                {uiText(" Показывать анкету другим владельцам")}
              </label>
              <div className="form-actions full" style={{"justifyContent": "flex-start"}}>
                <button type="submit" className="btn primary" id="btn-save-match-profile">{uiText("Сохранить анкету")}</button>
                <span id="match-profile-feedback" className="small" role="status" aria-live="polite" />
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
