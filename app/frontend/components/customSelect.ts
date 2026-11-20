/**
 * Drive the popup from the native select. Forms, validation and programmatic
 * changes continue to use the original field and selected value.
 */
export function installCustomSelects() {
  const menu = document.createElement('div');
  menu.id = 'petcare-select-options';
  menu.className = 'petcare-select-options';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  const topLayer = typeof menu.showPopover === 'function';
  if (topLayer) menu.setAttribute('popover', 'manual');

  let field: HTMLSelectElement | null = null;
  let entries: HTMLButtonElement[] = [];
  let highlighted = -1;
  let search = '';
  let lastKeyAt = 0;
  let optionObserver: MutationObserver | null = null;

  function close() {
    if (!field) return;
    field.removeAttribute('aria-expanded');
    field.removeAttribute('aria-controls');
    field.removeAttribute('aria-activedescendant');
    optionObserver?.disconnect();
    if (topLayer && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true;
    menu.remove();
    field = null;
    entries = [];
    search = '';
  }

  function position() {
    if (!field?.isConnected || field.disabled || !field.getClientRects().length) {
      close();
      return;
    }
    const rect = field.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) {
      close();
      return;
    }
    const width = Math.min(innerWidth - 16, Math.max(rect.width, 200));
    const below = innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const openAbove = below < 200 && above > below;
    const height = Math.max(0, Math.min(280, openAbove ? above : below));
    menu.style.width = width + 'px';
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
    menu.style.maxHeight = height + 'px';
    menu.style.top = (openAbove ? rect.top - 6 - menu.offsetHeight : rect.bottom + 6) + 'px';
  }

  function highlight(index: number) {
    if (!field || !entries[index] || entries[index].disabled) return;
    if (entries[highlighted]) delete entries[highlighted].dataset.active;
    highlighted = index;
    entries[index].dataset.active = 'true';
    field.setAttribute('aria-activedescendant', entries[index].id);
    const row = entries[index];
    if (row.offsetTop < menu.scrollTop) menu.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = row.offsetTop + row.offsetHeight - menu.clientHeight;
    }
  }

  function choose(index: number) {
    if (!field || entries[index]?.disabled || !entries[index]) return;
    const select = field;
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close();
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function renderOptions() {
    if (!field) return;
    const selected = field.selectedIndex;
    entries = [...field.options].map((option, index) => {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.tabIndex = -1;
      entry.id = menu.id + '-' + index;
      entry.disabled = option.disabled || Boolean(option.closest('optgroup')?.disabled);
      entry.hidden = option.hidden;
      entry.textContent = option.label;
      entry.setAttribute('role', 'option');
      entry.setAttribute('aria-selected', String(index === selected));
      entry.onclick = () => choose(index);
      return entry;
    });
    menu.replaceChildren(...entries);
    highlighted = -1;
    position();
    highlight(entries[selected]?.disabled || entries[selected]?.hidden
      ? entries.findIndex(entry => !entry.disabled && !entry.hidden)
      : selected);
  }

  function open(select: HTMLSelectElement) {
    close();
    if (!select.options.length || select.disabled) return;
    field = select;
    menu.hidden = false;
    (select.closest('dialog,.admin-shell,.admin-login') ?? document.body).append(menu);
    if (topLayer) menu.showPopover();
    select.setAttribute('aria-expanded', 'true');
    select.setAttribute('aria-controls', menu.id);
    optionObserver = new MutationObserver(renderOptions);
    optionObserver.observe(select, { childList: true, attributes: true, characterData: true, subtree: true,
      attributeFilter: ['disabled', 'hidden', 'label', 'selected'] });
    renderOptions();
  }

  function dropdown(target: EventTarget | null) {
    return target instanceof HTMLSelectElement && !target.multiple && target.size <= 1 && !target.disabled
      ? target : null;
  }

  document.addEventListener('pointerdown', event => {
    const select = dropdown(event.target);
    if (select && event.button === 0) {
      event.preventDefault();
      select.focus({ preventScroll: true });
    } else if (field && !menu.contains(event.target as Node)) {
      close();
    }
  }, true);
  menu.addEventListener('pointerdown', event => {
    if ((event.target as HTMLElement).closest('button')) event.preventDefault();
  });
  document.addEventListener('click', event => {
    const select = dropdown(event.target);
    if (!select) return;
    event.preventDefault();
    if (field === select) close();
    else open(select);
  }, true);

  document.addEventListener('keydown', event => {
    const select = dropdown(event.target);
    if (!select) return;
    const key = event.key;
    if (key === 'Tab') { close(); return; }
    const textKey = key.length === 1 && key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
    const openKey = [' ', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key);
    if (!(openKey || textKey || key === 'Escape' && field === select)) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === 'Escape') { close(); return; }
    const isOpen = field === select;
    if (!isOpen) open(select);
    if (key === 'Enter' || key === ' ') {
      if (isOpen) choose(highlighted);
      return;
    }
    if (textKey) {
      const now = Date.now();
      search = (now - lastKeyAt > 650 ? '' : search) + key.toLocaleLowerCase();
      lastKeyAt = now;
      highlight(entries.findIndex(entry => !entry.disabled && !entry.hidden &&
        entry.textContent?.trim().toLocaleLowerCase().startsWith(search)));
      return;
    }
    const direction = key === 'ArrowUp' || key === 'End' ? -1 : 1;
    const start = key === 'Home' ? 0 : key === 'End' ? entries.length - 1 : highlighted + direction;
    for (let index = start; index >= 0 && index < entries.length; index += direction) {
      if (!entries[index].disabled && !entries[index].hidden) { highlight(index); break; }
    }
  }, true);

  document.addEventListener('focusin', event => { if (field && event.target !== field && !menu.contains(event.target as Node)) close(); });
  document.addEventListener('close', event => { if (field && (event.target as Element).contains(field)) close(); }, true);
  window.addEventListener('resize', () => { if (field) position(); });
  document.addEventListener('scroll', event => { if (field && event.target !== menu) position(); }, true);
}
