import { formatLocale, uiText } from '../../i18n';
import type { FoodEntry, FoodKind, Rating } from './types';

export const kindLabels: Record<FoodKind, string> = {
  food: uiText("Корм"), treat: uiText("Лакомство"), supplement: uiText("Добавка"),
};
export const ratingLabel = (value?: Rating) => value === 'yes' ? uiText("Да") : value === 'no' ? uiText("Нет") : uiText("Не указано");
export const formatMoney = (value: number) => Number(value).toLocaleString(formatLocale) + ' ₽';
export const formatDate = (value: string) => value ? new Date(value.length === 10 ? value + 'T12:00:00' : value)
  .toLocaleDateString(formatLocale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function foodGroups(entries: readonly FoodEntry[]): FoodEntry[][] {
  const groups = new Map<string, FoodEntry[]>();
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = ((entry.brand || '') + ' ' + entry.food).trim().toLowerCase();
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()];
}

export function distinctSelection(groups: readonly FoodEntry[][], selected: readonly [number, number]): [number, number] {
  const a = groups[selected[0]] ? selected[0] : 0;
  const b = groups[selected[1]] && selected[1] !== a ? selected[1] : (a === 0 && groups.length > 1 ? 1 : 0);
  return [a, b];
}
