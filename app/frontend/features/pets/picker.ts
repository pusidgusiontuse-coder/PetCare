import { htmlUiText, uiText } from '../../i18n';
import { catalogName, other, searchCatalog, speciesCatalog, type CatalogEntry } from './catalog';

export function petCatalogMarkup() {
  function picker(key: 'species' | 'breed', label: string, placeholder: string, search: string) {
    return `<div class="field full pet-catalog-picker" data-pet-picker="${key}" ${key === 'breed' ? 'hidden' : ''}>
      <span id="pet-${key}-label">${htmlUiText(label)}</span>
      <input type="hidden" name="${key}">
      <button type="button" class="pet-catalog-trigger" aria-labelledby="pet-${key}-label pet-${key}-choice"
        aria-expanded="false" aria-controls="pet-${key}-menu" data-catalog-trigger>
        <span id="pet-${key}-choice" data-catalog-choice>${htmlUiText(placeholder)}</span>
        <span class="pet-catalog-chevron" aria-hidden="true"></span>
      </button>
      <div id="pet-${key}-menu" class="pet-catalog-menu" hidden>
        <input type="search" autocomplete="off" maxlength="80" aria-label="${htmlUiText(search)}"
          placeholder="${htmlUiText(search)}" data-catalog-search>
        <p class="small pet-catalog-empty" role="status" hidden>${htmlUiText('Ничего не найдено')}</p>
        <div class="pet-catalog-options" data-catalog-options></div>
      </div>
    </div>`;
  }
  return picker('species', 'Вид животного', 'Выбрать вид', 'Поиск по видам') +
    picker('breed', 'Порода или разновидность', 'Выбрать породу', 'Поиск по породам') +
    `<label class="field full pet-catalog-custom" hidden>${htmlUiText('Своя порода или разновидность')}
      <input type="text" name="customBreed" maxlength="100" disabled>
    </label>`;
}

type CatalogSelection<T> = (entry: T) => void;

function bindPicker<T extends CatalogEntry>(root: HTMLElement, onSelect: CatalogSelection<T>, keepLast?: T) {
  const trigger = root.querySelector<HTMLButtonElement>('[data-catalog-trigger]')!;
  const choice = root.querySelector<HTMLElement>('[data-catalog-choice]')!;
  const placeholder = choice.textContent ?? '';
  const menu = root.querySelector<HTMLElement>('.pet-catalog-menu')!;
  const search = root.querySelector<HTMLInputElement>('[data-catalog-search]')!;
  const results = root.querySelector<HTMLElement>('[data-catalog-options]')!;
  const empty = root.querySelector<HTMLElement>('.pet-catalog-empty')!;
  const value = root.querySelector<HTMLInputElement>('input[type=hidden]')!;
  let entries: readonly T[] = [];
  let selected: T | undefined;

  function close(restoreFocus = false) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function choose(option: T) {
    const changed = selected !== option;
    selected = option;
    if (changed) value.value = option.ru;
    choice.textContent = catalogName(option);
    close(true);
    if (changed) {
      onSelect(option);
      value.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function render() {
    const matches = searchCatalog(entries, search.value);
    const visible = keepLast ? [...matches, keepLast] : matches;
    empty.hidden = matches.length > 0;
    results.replaceChildren(...visible.map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = catalogName(option);
      button.setAttribute('aria-pressed', String(option === selected));
      button.addEventListener('click', () => choose(option));
      return button;
    }));
  }

  trigger.addEventListener('click', () => {
    if (!menu.hidden) { close(); return; }
    search.value = '';
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    render();
    search.focus();
  });
  search.addEventListener('input', render);
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = results.querySelector('button');
      first?.click();
    }
  });
  root.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...results.querySelectorAll('button')];
    const position = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? position + 1 : position - 1;
    if (next < 0) search.focus();
    else buttons[Math.min(next, buttons.length - 1)]?.focus();
  });
  root.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) close();
  });

  return {
    replaceOptions(options: readonly T[]) {
      entries = options;
      selected = undefined;
      value.value = '';
      choice.textContent = placeholder;
      close();
    },
    value,
  };
}

export function bindPetCatalog(form: HTMLFormElement) {
  const speciesRoot = form.querySelector<HTMLElement>('[data-pet-picker=species]')!;
  const breedRoot = form.querySelector<HTMLElement>('[data-pet-picker=breed]')!;
  const customBreed = form.querySelector<HTMLInputElement>('[name=customBreed]')!;
  const customField = customBreed.closest<HTMLElement>('.field')!;
  const details = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name=sex], [name=sterilized], [name=birthDate]');

  function showDetails(visible: boolean) {
    for (const input of details) {
      input.closest<HTMLElement>('.field')!.hidden = !visible;
      input.disabled = !visible;
    }
  }

  function showCustom(visible: boolean) {
    customField.hidden = !visible;
    customBreed.disabled = !visible;
    customBreed.required = visible;
    if (!visible) customBreed.value = '';
  }

  const breedPicker = bindPicker(breedRoot, option => {
    const manual = option === other;
    showCustom(manual);
    showDetails(!manual);
    if (manual) {
      breedPicker.value.value = '';
      customBreed.focus();
    }
  }, other);
  const speciesPicker = bindPicker<(typeof speciesCatalog)[number]>(speciesRoot, option => {
    breedRoot.hidden = false;
    breedPicker.replaceOptions(option.breeds);
    showCustom(false);
    showDetails(false);
  });
  speciesPicker.replaceOptions(speciesCatalog);

  customBreed.addEventListener('input', () => {
    breedPicker.value.value = customBreed.value.trim();
    showDetails(Boolean(breedPicker.value.value));
  });
  showDetails(false);
}

export const catalogRequiredMessage = () => uiText('Выберите вид и породу питомца или укажите свою породу.');
