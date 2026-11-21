import { language, uiText } from './i18n';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App } from './App';
import { installCustomSelects } from './components/customSelect';

installCustomSelects();

document.documentElement.lang = language;
document.title = uiText(document.title);
document.querySelectorAll<HTMLMetaElement>('meta[name="description"], meta[property="og:title"], meta[property="og:description"]')
  .forEach(meta => { meta.content = uiText(meta.content); });
const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
if (manifest && language === 'en') manifest.href = '/manifest.webmanifest?lang=en';
document.querySelectorAll('#petcare-startup p, #petcare-startup a').forEach(element => {
  element.textContent = uiText(element.textContent ?? '');
});

const startupAbout = document.querySelector<HTMLAnchorElement>('#petcare-startup a[href="/about"]');
if (startupAbout && language === 'en') startupAbout.href = '/about?lang=en';

const container = document.getElementById('root');
if (!container) throw new Error('PetCare root element is missing');

const showError = (error: unknown) => {
  console.error('PetCare initialization failed', error);
  const message = document.createElement('p');
  message.textContent = uiText("Не удалось загрузить PetCare. Проверьте подключение к интернету.");
  const retry = document.createElement('a');
  retry.href = location.href;
  retry.textContent = uiText("Обновить страницу");
  retry.addEventListener('click', event => {
    event.preventDefault();
    location.reload();
  });
  const status = document.getElementById('petcare-startup') ?? container;
  status.setAttribute('role', 'alert');
  status.replaceChildren(message, retry);
};

const root = createRoot(container);
if (location.pathname.replace(/\/$/, '') === '/admin') {
  void import('./features/admin/AdminApp')
    .then(({ AdminApp }) => {
      flushSync(() => root.render(<AdminApp />));
      document.getElementById('petcare-startup')?.remove();
    })
    .catch(showError);
} else {
  // Commit the shell before the transitional handlers query its empty containers.
  flushSync(() => root.render(<App />));
  void import('./legacy/runtime.js').catch(showError);
}
