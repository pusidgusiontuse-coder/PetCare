import { uiText, htmlUiText } from '../i18n';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type UploadKind = 'document' | 'photo';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function uploadError(file: Pick<File, 'size' | 'type'>, kind: UploadKind): string {
  if (!file.size) return uiText("Этот файл пуст. Выберите другой.");
  if (file.size > MAX_UPLOAD_BYTES) return uiText("Файл больше 10 МБ. Выберите файл поменьше.");
  if (![...IMAGE_TYPES, ...(kind === 'document' ? ['application/pdf'] : [])].includes(file.type)) {
    return kind === 'document' ? uiText("Выберите PDF, JPG, PNG или WebP.") : uiText("Выберите фото в формате JPG, PNG или WebP.");
  }
  return '';
}

export function readUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(uiText("Не удалось прочитать файл. Выберите его ещё раз.")));
    reader.onabort = () => reject(new Error(uiText("Чтение файла прервано.")));
    reader.readAsDataURL(file);
  });
}

// Used by both the React shell and the legacy modal form.
export function filePickerMarkup(id: string, name: string, kind: UploadKind, title: string, required = false): string {
  const accept = kind === 'document' ? 'application/pdf,image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp';
  const hint = kind === 'document' ? uiText("PDF, JPG, PNG или WebP · до 10 МБ") : uiText("JPG, PNG или WebP · до 10 МБ");
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]!));
  id = escape(id); name = escape(name); title = escape(title);
  return `${"<div class=\"field full file-picker\" data-file-picker data-kind=\""}${kind}${"\">"+"\n    "+"<span id=\""}${id}${"-label\">"}${title}${"</span>"+"\n    "+"<input class=\"upload-input\" id=\""}${id}${"\" name=\""}${name}${"\" type=\"file\" accept=\""}${accept}${"\" aria-labelledby=\""}${id}${"-label\" aria-describedby=\""}${id}${"-hint "}${id}${"-error\" tabindex=\"-1\" "}${required ? 'required' : ''}${">"+"\n    "+"<div class=\"upload-preview\" data-upload-preview>"+"<span class=\"upload-placeholder\" aria-hidden=\"true\">"+"＋"+"</span>"+"<span>"+htmlUiText("Здесь появится предпросмотр")+"</span>"+"</div>"+"\n    "+"<div class=\"upload-info\">"+"<strong data-upload-name>"+htmlUiText("Файл не выбран")+"</strong>"+"<small data-upload-meta id=\""}${id}${"-hint\">"}${hint}${"</small>"+"</div>"+"\n    "+"<div class=\"upload-actions\">"+"<button class=\"btn\" data-upload-choose type=\"button\">"}${kind === 'photo' ? uiText("Выбрать фото") : uiText("Выбрать файл")}${"</button>"+"<button class=\"btn ghost\" data-upload-reset type=\"button\" hidden>"+htmlUiText("Убрать")+"</button>"+"</div>"+"\n    "+"<p class=\"upload-error\" id=\""}${id}${"-error\" data-upload-error role=\"status\" aria-live=\"polite\">"+"</p>"+"\n  "+"</div>"}`;
}

export function bindFilePicker(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  const preview = root.querySelector<HTMLElement>('[data-upload-preview]')!;
  const name = root.querySelector<HTMLElement>('[data-upload-name]')!;
  const meta = root.querySelector<HTMLElement>('[data-upload-meta]')!;
  const error = root.querySelector<HTMLElement>('[data-upload-error]')!;
  const choose = root.querySelector<HTMLButtonElement>('[data-upload-choose]')!;
  const reset = root.querySelector<HTMLButtonElement>('[data-upload-reset]')!;
  const kind = root.dataset.kind as UploadKind;
  const hint = meta.textContent;
  let fallbackPhoto = '', objectUrl = '', generation = 0;
  let destroyPdf: (() => Promise<void>) | undefined;

  function clearPreview() {
    generation++;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    if (destroyPdf) { void destroyPdf(); destroyPdf = undefined; }
    preview.replaceChildren();
    preview.classList.remove('has-preview', 'pdf-preview');
  }
  function showFallback() {
    clearPreview();
    const content = document.createElement(fallbackPhoto ? 'img' : 'span');
    if (content instanceof HTMLImageElement) {
      content.src = fallbackPhoto; content.alt = uiText("Фото питомца для анкеты");
      preview.classList.add('has-preview');
    } else { content.textContent = '＋'; content.className = 'upload-placeholder'; }
    preview.append(content);
    if (!fallbackPhoto) { const label = document.createElement('span'); label.textContent = uiText("Здесь появится предпросмотр"); preview.append(label); }
    name.textContent = fallbackPhoto ? uiText("Фото питомца") : uiText("Файл не выбран");
    meta.textContent = fallbackPhoto ? uiText("Будет использовано в анкете. Можно заменить.") : hint;
    choose.textContent = fallbackPhoto ? uiText("Заменить фото") : kind === 'photo' ? uiText("Выбрать фото") : uiText("Выбрать файл");
    reset.hidden = true;
  }
  async function showFile(file: File) {
    clearPreview();
    const token = generation;
    objectUrl = URL.createObjectURL(file);
    name.textContent = file.name;
    const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))}${" "+uiText("КБ")}` : `${(file.size / 1024 / 1024).toLocaleString('ru', {maximumFractionDigits: 1})}${" "+uiText("МБ")}`;
    meta.textContent = `${size} · ${file.type === 'application/pdf' ? 'PDF' : uiText("Фото")}`;
    choose.textContent = kind === 'photo' ? uiText("Заменить фото") : uiText("Заменить файл");
    reset.textContent = fallbackPhoto ? uiText("Вернуть фото питомца") : uiText("Убрать");
    reset.hidden = false;
    preview.classList.add('has-preview');
    if (file.type !== 'application/pdf') {
      const image = document.createElement('img');
      image.alt = (uiText("Предпросмотр:")+" ") + file.name; image.src = objectUrl;
      image.onerror = () => { if (token === generation) { input.value = ''; showFallback(); error.textContent = uiText("Не удалось открыть фото. Возможно, файл повреждён."); } };
      preview.append(image);
      return;
    }
    preview.classList.add('pdf-preview');
    preview.textContent = uiText("Готовим предпросмотр PDF…");
    try {
      const {getDocument, GlobalWorkerOptions} = await import('pdfjs-dist');
      if (token !== generation) return;
      GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = getDocument({data: new Uint8Array(await file.arrayBuffer())});
      if (token !== generation) { void task.destroy(); return; }
      destroyPdf = () => task.destroy();
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      if (token !== generation) return;
      const initial = page.getViewport({scale: 1});
      const viewport = page.getViewport({scale: Math.min(2, 800 / initial.width, 1000 / initial.height)});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', (uiText("Первая страница PDF:")+" ") + file.name);
      await page.render({canvas, viewport}).promise;
      if (token !== generation) return;
      preview.replaceChildren(canvas);
      meta.textContent += `${" · "+uiText("Страница 1 из")+" "}${pdf.numPages}`;
    } catch {
      if (token === generation) {
        input.value = ''; showFallback();
        error.textContent = uiText("Не удалось открыть PDF. Выберите PDF без пароля и проверьте, что файл не повреждён.");
      }
    }
  }
  choose.onclick = () => input.click();
  input.oninvalid = event => { event.preventDefault(); error.textContent = uiText("Сначала выберите файл."); choose.focus(); };
  input.onchange = () => {
    error.textContent = '';
    const file = input.files?.[0];
    if (!file) return;
    const message = uploadError(file, kind);
    if (message) { input.value = ''; showFallback(); error.textContent = message; return; }
    void showFile(file);
  };
  reset.onclick = () => { input.value = ''; error.textContent = ''; showFallback(); choose.focus(); };
  showFallback();
  return {
    setPhoto(photo = '') { fallbackPhoto = photo; input.value = ''; error.textContent = ''; showFallback(); },
    dispose() { clearPreview(); },
  };
}
