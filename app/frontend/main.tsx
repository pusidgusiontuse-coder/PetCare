import '../static/local-ocr.js';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('PetCare root element is missing');

// Commit the shell before the transitional handlers query its empty containers.
flushSync(() => createRoot(container).render(<App />));
void import('./legacy/runtime.js').catch(error => {
  console.error('PetCare initialization failed', error);
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'Не удалось загрузить PetCare. Обновите страницу и попробуйте ещё раз.';
  container.prepend(message);
});
