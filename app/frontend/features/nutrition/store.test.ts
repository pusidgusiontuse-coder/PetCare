import { expect, it, vi } from 'vitest';
import { getNutritionSnapshot, publishNutrition, resetNutritionFilters, subscribeNutrition } from './store';
import type { FoodEntry } from './types';

it('isolates React snapshots from legacy array/object mutations', () => {
  const entry: FoodEntry & { reactions: string[] } = { id: '1', food: 'Корм', kind: 'food', date: '2026-11-16', reactions: ['Зуд'] };
  publishNutrition([entry], () => {});
  const snapshot = getNutritionSnapshot();
  entry.food = 'Изменён';
  entry.reactions.push('Новая реакция');
  expect(getNutritionSnapshot()).toBe(snapshot);
  expect(snapshot.entries[0].food).toBe('Корм');
  expect(snapshot.entries[0].reactions).toEqual(['Зуд']);
});

it('resets view state explicitly and unsubscribes listeners', () => {
  const listener = vi.fn();
  const unsubscribe = subscribeNutrition(listener);
  const version = getNutritionSnapshot().resetVersion;
  resetNutritionFilters();
  expect(getNutritionSnapshot().resetVersion).toBe(version + 1);
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  resetNutritionFilters();
  expect(listener).toHaveBeenCalledOnce();
});
