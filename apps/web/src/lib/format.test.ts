import { describe, expect, it } from 'vitest';
import { formatAttendance, formatPercentage, formatScore, formatStat } from './format.ts';

describe('formatScore', () => {
  it('writes goals.behinds (points)', () => {
    expect(formatScore(11, 15, 81)).toBe('11.15 (81)');
    expect(formatScore(0, 0, 0)).toBe('0.0 (0)');
  });
});

describe('formatPercentage', () => {
  it('shows two decimal places', () => {
    expect(formatPercentage(161)).toBe('161.00');
    expect(formatPercentage(62.11)).toBe('62.11');
    expect(formatPercentage(123.456)).toBe('123.46');
  });

  it('shows a dash before a team has any points against', () => {
    expect(formatPercentage(null)).toBe('–');
  });
});

describe('formatStat and formatAttendance', () => {
  it('shows a dash for values outside coverage', () => {
    expect(formatStat(0)).toBe('0');
    expect(formatStat(54.5)).toBe('54.5');
    expect(formatStat(null)).toBe('–');
  });

  it('groups attendance thousands', () => {
    expect(formatAttendance(100022)).toBe('100,022');
    expect(formatAttendance(7395)).toBe('7,395');
    expect(formatAttendance(null)).toBe('–');
  });
});
