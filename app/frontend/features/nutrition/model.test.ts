import { describe, expect, it } from 'vitest';
import { distinctSelection, foodGroups } from './model';
import type { FoodEntry } from './types';

const entry = (id: string, food: string, date: string, brand = ''): FoodEntry => ({ id, food, date, brand, kind: 'food' });

describe('food comparison', () => {
  it('groups case-insensitive brand/name pairs and keeps chronological history without mutating input', () => {
    const rows = [entry('new', 'Корм', '2026-11-16', 'Бренд'), entry('old', 'корм', '2026-10-01', 'бренд'), entry('other', 'Корм', '2026-11-15', 'Другой')];
    const groups = foodGroups(rows);
    expect(groups.map(group => group.map(row => row.id))).toEqual([['old', 'new'], ['other']]);
    expect(rows[0].id).toBe('new');
  });

  it('falls back to two different foods when old selections disappear', () => {
    const groups = [[entry('1', 'А', '2026-11-16')], [entry('2', 'Б', '2026-11-16')]];
    expect(distinctSelection(groups, [9, 9])).toEqual([0, 1]);
    expect(distinctSelection(groups, [1, 1])).toEqual([1, 0]);
    expect(distinctSelection(groups, [1, 0])).toEqual([1, 0]);
  });
});
