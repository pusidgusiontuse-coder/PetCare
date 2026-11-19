import { uiText } from '../i18n';

export function AppHeader() {
  return (
    <>
      <header className="app-header">
        <div id="breadcrumbs" className="breadcrumbs" />
        <div className="header-tools">
          <span className="header-date" id="header-date" />
          <button className="btn" id="api-open" type="button" hidden>{uiText("Войти в аккаунт")}</button>
        </div>
      </header>
    </>
  );
}
