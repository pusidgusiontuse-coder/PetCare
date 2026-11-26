import { describe, expect, it } from 'vitest';
import { isGreetingDay, isNewYearSeason } from './season';

describe('New Year release', () => {
  it('shows the fireworks only on 1 January 2027 in Moscow', () => {
    expect(isGreetingDay(Date.parse('2026-12-31T20:59:59.999Z'))).toBe(false);
    expect(isGreetingDay(Date.parse('2026-12-31T21:00:00.000Z'))).toBe(true);
    expect(isGreetingDay(Date.parse('2027-01-01T20:59:59.999Z'))).toBe(true);
    expect(isGreetingDay(Date.parse('2027-01-01T21:00:00.000Z'))).toBe(false);
  });
  it('starts at midnight in Moscow, including for users in other time zones', () => {
    expect(isNewYearSeason(Date.parse('2026-11-30T20:59:59.999Z'))).toBe(false);
    expect(isNewYearSeason(Date.parse('2026-11-30T21:00:00.000Z'))).toBe(true);
  });

  it('can be previewed early and stays active until it is removed', () => {
    expect(isNewYearSeason(Date.parse('2026-11-26T00:00:00Z'), true)).toBe(true);
    expect(isNewYearSeason(Date.parse('2027-01-08T00:00:00Z'))).toBe(true);
  });
});
