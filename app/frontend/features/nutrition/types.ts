export type FoodKind = 'food' | 'treat' | 'supplement';
export type Rating = 'yes' | 'no' | 'unknown';

export interface FoodEntry {
  id: string;
  food: string;
  brand?: string;
  kind: FoodKind;
  date: string;
  liked?: Rating;
  tolerated?: Rating;
  reactions?: readonly string[];
  notes?: string;
  price?: number | null;
}
