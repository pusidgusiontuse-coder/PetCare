
export function MatchPage() {
  return (
    <>
      <section hidden id="match" className="section">
        <div className="topline">
          <div>
            <p className="eyebrow">
              СООБЩЕСТВО ХВОСТАТЫХ
            </p>
            <h1>
              Поиск друзей
            </h1>
            <span className="subtle" id="match-pet-subtitle" />
          </div>
          <button className="btn primary" id="btn-open-my-match-form" type="button">
            Анкета питомца
          </button>
        </div>
        <div className="match-context-bar" id="match-context-bar" />
        <div className="match-mode-tabs" role="tablist" aria-label="Разделы поиска друзей">
          <button type="button" className="match-mode-tab active" data-match-tab="discover" role="tab" aria-selected="true">
            <span>
              Анкеты питомцев
            </span>
            <span className="match-tab-count" id="match-discover-count">
              0
            </span>
          </button>
          <button type="button" className="match-mode-tab" data-match-tab="incoming" role="tab" aria-selected="false">
            <span>
              Вас лайкнули
            </span>
            <span className="match-tab-count hot" id="match-incoming-count">
              0
            </span>
          </button>
          <button type="button" className="match-mode-tab" data-match-tab="liked" role="tab" aria-selected="false">
            <span>
              Отмеченные анкеты
            </span>
            <span className="match-tab-count" id="match-liked-count">
              0
            </span>
          </button>
          <button type="button" className="match-mode-tab" data-match-tab="profile" role="tab" aria-selected="false">
            <span>
              Анкета питомца
            </span>
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
                <h2>
                  Кому понравился ваш питомец
                </h2>
                <p className="small" style={{"margin": "4px 0 0"}}>
                  Посмотрите анкету питомца, ответьте лайком или скопируйте контакты хозяина прямо из карточки
                </p>
              </div>
            </div>
            <div id="match-incoming-list" className="match-cards-grid" />
          </div>
        </div>
        <div id="match-pane-liked" hidden>
          <div className="panel glass">
            <div className="panel-head">
              <div>
                <h2>
                  Отмеченные анкеты
                </h2>
                <p className="small" style={{"margin": "4px 0 0"}}>
                  Питомцы, которых вы отметили лайком, и контакты их хозяев
                </p>
              </div>
            </div>
            <div id="match-liked-list" className="match-cards-grid" />
          </div>
        </div>
        <div id="match-pane-profile" hidden>
          <div className="panel glass">
            <div className="panel-head">
              <div>
                <h2 id="match-form-heading">
                  Анкета питомца
                </h2>
                <p className="small" style={{"margin": "4px 0 0"}}>
                  Заполните анкету для активного питомца, чтобы другие владельцы могли найти вас
                </p>
              </div>
            </div>
            <form id="match-profile-form" className="form-grid">
              <label className="field">
                {"Имя питомца\n              "}
                <input name="name" type="text" required placeholder="Например: Барсик" />
              </label>
              <label className="field">
                {"Вид животного\n              "}
                <input name="species" type="text" required placeholder="Кот, Кошка, Собака…" />
              </label>
              <label className="field">
                {"Порода\n              "}
                <input name="breed" type="text" required placeholder="Британская короткошёрстная, Овчарка…" />
              </label>
              <label className="field">
                {"Дата рождения\n              "}
                <input name="birth_date" type="date" />
              </label>
              <label className="field">
                {"Пол\n              "}
                <select name="sex">
                  <option value="Неизвестно">
                    Не указано
                  </option>
                  <option value="Самец">
                    Самец
                  </option>
                  <option value="Самка">
                    Самка
                  </option>
                </select>
              </label>
              <label className="field">
                {"Прививки\n              "}
                <select name="vaccinated">
                  <option value="Не указано">
                    Не указано
                  </option>
                  <option value="Да, все по возрасту">
                    Да, все по возрасту
                  </option>
                  <option value="Частично (по графику)">
                    Частично (по графику)
                  </option>
                  <option value="Нет прививок">
                    Нет прививок
                  </option>
                </select>
              </label>
              <label className="field">
                {"Стерилизация / кастрация\n              "}
                <select name="sterilized">
                  <option value="Нет">
                    Нет
                  </option>
                  <option value="Да">
                    Да
                  </option>
                </select>
              </label>
              <label className="field">
                {"Цель поиска\n              "}
                <select name="purpose">
                  <option value="Совместные прогулки и игры">
                    Совместные прогулки и игры
                  </option>
                  <option value="Поиск компании по породе">
                    Поиск компании по породе
                  </option>
                  <option value="Вязка / продолжение рода">
                    Вязка / продолжение рода
                  </option>
                </select>
              </label>
              <label className="field">
                {"Город и район\n              "}
                <input name="city" type="text" placeholder="Например: Москва, Сокольники" />
              </label>
              <label className="field">
                {"Имя хозяина\n              "}
                <input name="owner_name" type="text" required placeholder="Ваше имя" />
              </label>
              <label className="field full">
                {"Контакты хозяина для связи (обязательно)\n              "}
                <input name="owner_contact" type="text" required placeholder="Telegram: @username, телефон +7 (999) 000-00-00 или WhatsApp" />
              </label>
              <label className="field full">
                {"О питомце (характер, привычки, кого ищете)\n              "}
                <textarea name="bio" rows={4} placeholder="Расскажите о характере питомца и кого ищете для прогулок или общения" />
              </label>
              <label className="field full">
                {"Фотография для анкеты (необязательно)\n              "}
                <input name="photo_file" id="match-photo-input" type="file" accept="image/jpeg,image/png,image/webp" />
              </label>
              <div className="form-actions full" style={{"justifyContent": "flex-start"}}>
                <button type="submit" className="btn primary" id="btn-save-match-profile">
                  Выложить анкету в базу
                </button>
                <span id="match-profile-feedback" className="small" role="status" aria-live="polite" />
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}
