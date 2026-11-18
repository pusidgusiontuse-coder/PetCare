import type { FoodEntry } from './types';

let snapshot: { entries: readonly FoodEntry[]; onAdd: () => void; resetVersion: number } = {
  entries: [], onAdd: () => {}, resetVersion: 0,
};
const listeners = new Set<() => void>();

export function publishNutrition(entries: readonly FoodEntry[], onAdd: () => void) {
  // Legacy state is mutable. React consumes its own stable snapshot until the next publication.
  snapshot = { resetVersion: snapshot.resetVersion, entries: entries.map(entry => ({ ...entry, reactions: entry.reactions ? [...entry.reactions] : undefined })), onAdd };
  for (const listener of listeners) listener();
}
export const getNutritionSnapshot = () => snapshot;
export function subscribeNutrition(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetNutritionFilters() {
  snapshot = { ...snapshot, resetVersion: snapshot.resetVersion + 1 };
  for (const listener of listeners) listener();
}
