import { htmlUiText, uiText } from '../../i18n';
import { catalogName, other, searchCatalog, speciesCatalog, type CatalogEntry } from './catalog';

export function petCatalogMarkup() {
  function picker(key: 'species' | 'breed', label: string, placeholder: string) {
    return `<div class="field full pet-catalog-picker" data-pet-picker="${key}" ${key === 'breed' ? 'hidden' : ''}>
      <label for="pet-${key}-search">${htmlUiText(label)}</label>
      <input type="hidden" name="${key}">
      <div class="pet-catalog-control">
        <input id="pet-${key}-search" type="text" role="combobox" aria-autocomplete="list"
          aria-expanded="false" aria-controls="pet-${key}-options"
          autocomplete="off" maxlength="80" placeholder="${htmlUiText(placeholder)}" data-catalog-search>
        <span class="pet-catalog-chevron" aria-hidden="true"></span>
      </div>
      <div class="pet-catalog-menu" hidden>
        <p class="small pet-catalog-empty" role="status" hidden>${htmlUiText('Ничего не найдено')}</p>
        <div id="pet-${key}-options" class="pet-catalog-options" role="listbox"
          aria-label="${htmlUiText(label)}" data-catalog-options></div>
      </div>
    </div>`;
  }
  return picker('species', 'Вид животного', 'Поиск по видам') +
    picker('breed', 'Порода или разновидность', 'Поиск по породам') +
    `<label class="field full pet-catalog-custom" hidden>${htmlUiText('Своя порода или разновидность')}
      <input type="text" name="customBreed" maxlength="100" disabled>
    </label>`;
}

type CatalogSelection<T> = (entry: T | undefined) => void;

function bindPicker<T extends CatalogEntry>(root: HTMLElement, onSelect: CatalogSelection<T>, keepLast?: T) {
  const menu = root.querySelector<HTMLElement>('.pet-catalog-menu')!;
  const search = root.querySelector<HTMLInputElement>('[data-catalog-search]')!;
  const results = root.querySelector<HTMLElement>('[data-catalog-options]')!;
  const empty = root.querySelector<HTMLElement>('.pet-catalog-empty')!;
  const value = root.querySelector<HTMLInputElement>('input[type=hidden]')!;
  let entries: readonly T[] = [];
  let selected: T | undefined;
  let matches: readonly T[] = [];
  let buttons: HTMLButtonElement[] = [];
  let highlighted = -1;

  function close() {
    menu.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  }

  function choose(option: T) {
    const changed = selected !== option;
    selected = option;
    search.value = catalogName(option);
    close();
    if (changed) {
      value.value = option.ru;
      onSelect(option);
      value.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function render(query: string) {
    matches = searchCatalog(entries, query);
    const visible = keepLast ? [...matches, keepLast] : matches;
    empty.hidden = matches.length > 0;
    highlighted = -1;
    search.removeAttribute('aria-activedescendant');
    buttons = visible.map((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.id = results.id + '-' + index;
      button.textContent = catalogName(option);
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option === selected));
      button.addEventListener('click', () => {
        choose(option);
        search.blur();
      });
      return button;
    });
    results.replaceChildren(...buttons);
    results.scrollTop = 0;
  }

  function open(query: string) {
    menu.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    render(query);
  }

  function openOnFocus() {
    if (!menu.hidden) return;
    open(selected ? '' : search.value);
    if (selected) search.select();
  }

  search.addEventListener('focus', openOnFocus);
  search.addEventListener('click', openOnFocus);
  search.addEventListener('input', () => {
    if (selected) {
      selected = undefined;
      value.value = '';
      onSelect(undefined);
      value.dispatchEvent(new Event('change', { bubbles: true }));
    }
    open(search.value);
  });
  function commitExact() {
    if (menu.hidden || selected) return;
    const text = search.value.trim().toLocaleLowerCase();
    const exact = [...matches, ...(keepLast ? [keepLast] : [])].find(option =>
      [option.ru, option.en, ...option.aliases].some(name => name.toLocaleLowerCase() === text));
    if (exact) choose(exact);
  }

  search.addEventListener('blur', () => {
    commitExact();
    close();
  });
  // A pointer selecting an option must not blur and close the list before click.
  results.addEventListener('pointerdown', event => {
    if (event.button === 0 && (event.target as HTMLElement).closest('button')) event.preventDefault();
  });

  search.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      commitExact();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (menu.hidden) { openOnFocus(); return; }
      const option = highlighted < 0 ? matches[0] : (matches[highlighted] ?? keepLast);
      if (option) choose(option);
    } else if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openOnFocus();
      if (!buttons.length) return;
      const next = event.key === 'ArrowDown' ? highlighted + 1 : (highlighted < 0 ? buttons.length - 1 : highlighted - 1);
      buttons[highlighted]?.removeAttribute('data-active');
      highlighted = Math.max(0, Math.min(next, buttons.length - 1));
      const button = buttons[highlighted];
      button.dataset.active = 'true';
      search.setAttribute('aria-activedescendant', button.id);
      button.scrollIntoView({ block: 'nearest' });
    }
  });

  return {
    replaceOptions(options: readonly T[]) {
      entries = options;
      selected = undefined;
      value.value = '';
      search.value = '';
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
    showDetails(Boolean(option && !manual));
    if (manual) {
      breedPicker.value.value = '';
      customBreed.focus();
    }
  }, other);
  const speciesPicker = bindPicker<(typeof speciesCatalog)[number]>(speciesRoot, option => {
    breedRoot.hidden = !option;
    breedPicker.replaceOptions(option?.breeds ?? []);
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
