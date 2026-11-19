import { uiText } from './i18n';
import { Icons } from './components/Icons';
import { Sidebar } from './components/Sidebar';
import { AppHeader } from './components/AppHeader';
import { GuestPreview } from './components/GuestPreview';
import { Dialogs } from './components/Dialogs';
import { PetsPage } from './pages/PetsPage';
import { HealthPage } from './pages/HealthPage';
import { NutritionPage } from './pages/NutritionPage';
import { CarePage } from './pages/CarePage';
import { MatchPage } from './pages/MatchPage';
import { ProfilePage } from './pages/ProfilePage';

// Legacy code fills empty data containers. This shell mounts once and does not
// reconcile their contents; NutritionTools owns its entire subtree in React.
export function App() {
  return <>
    <Icons />
    <div className="app" id="petcare-shell" data-session-view="loading" inert>
      <a className="skip-link" href="#main-content">{uiText("К содержимому")}</a>
      <Sidebar />
      <main className="content" id="main-content" tabIndex={-1}>
        <AppHeader />
        <GuestPreview />
        <PetsPage />
        <HealthPage />
        <NutritionPage />
        <CarePage />
        <MatchPage />
        <ProfilePage />
      </main>
    </div>
    <Dialogs />
    <div id="connection-status" className="connection-status" role="status" hidden>
      <span className="connection-spinner" aria-hidden="true" />
      <span id="connection-message">{uiText("Загружаем данные…")}</span>
      <button id="connection-retry" type="button" hidden>{uiText("Повторить")}</button>
    </div>
    <div id="push-banner-stack" className="push-banner-stack" aria-live="assertive" />
    <div id="toast" className="toast" role="status" aria-live="polite" />
  </>;
}
