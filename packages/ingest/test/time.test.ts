import { describe, expect, it } from 'vitest';
import { PageDateError, parsePageDateTime } from '../src/afltables/time.ts';
import { readFixtureBytes } from './helpers.ts';

describe('parsePageDateTime', () => {
  it('uses the bracketed AEST time (MCG in March, venue on daylight saving)', () => {
    expect(parsePageDateTime('Sat, 22-Mar-2025 1:20 PM (12:20 PM)')).toEqual({
      date: '2025-03-22',
      localTime: 'Sat, 22-Mar-2025 1:20 PM',
      startUtc: '2025-03-22T02:20:00.000Z',
    });
  });

  it('uses the local time when there is no bracket (venue already on AEST)', () => {
    expect(parsePageDateTime('Sun, 11-May-2025 1:10 PM').startUtc).toBe('2025-05-11T03:10:00.000Z');
  });

  it('handles a venue behind AEST (Adelaide in July)', () => {
    expect(parsePageDateTime('Fri, 04-Jul-2025 4:10 PM (4:40 PM)').startUtc).toBe(
      '2025-07-04T06:40:00.000Z',
    );
  });

  it('rolls the AEST time into the next day after midnight (synthetic Perth night game)', () => {
    expect(parsePageDateTime('Sat, 12-Jul-2025 10:20 PM (12:20 AM)')).toEqual({
      date: '2025-07-12',
      localTime: 'Sat, 12-Jul-2025 10:20 PM',
      startUtc: '2025-07-12T14:20:00.000Z',
    });
  });

  it('accepts the season page form, without a comma after the weekday', () => {
    expect(parsePageDateTime('Fri 15-Aug-2025 6:35 PM (8:35 PM)')).toEqual({
      date: '2025-08-15',
      localTime: 'Fri 15-Aug-2025 6:35 PM',
      startUtc: '2025-08-15T10:35:00.000Z',
    });
  });

  it('reads 12 PM as noon and 12 AM as midnight', () => {
    expect(parsePageDateTime('Sun, 11-May-2025 12:05 PM').startUtc).toBe(
      '2025-05-11T02:05:00.000Z',
    );
    expect(parsePageDateTime('Sun, 11-May-2025 12:05 AM').startUtc).toBe(
      '2025-05-10T14:05:00.000Z',
    );
  });

  it.each([
    '',
    'Sat, 22-Mar-2025',
    'Sat, 22-Foo-2025 1:20 PM',
    'Sat, 31-Feb-2025 1:20 PM',
    'Sat, 22-Mar-2025 13:20 PM',
    'Sat, 22-Mar-2025 1:20 PM (late)',
  ])('throws on %j', (text) => {
    expect(() => parsePageDateTime(text)).toThrow(PageDateError);
  });
});

describe('parsePageDateTime against Squiggle unixtime', () => {
  const games = JSON.parse(readFixtureBytes('squiggle/games-2025.json').toString('utf8')).games as {
    date: string;
    hteam: string;
    unixtime: number;
  }[];

  it.each([
    ['Sat, 22-Mar-2025 1:20 PM (12:20 PM)', 'Essendon'],
    ['Sun, 11-May-2025 1:10 PM', 'Richmond'],
    ['Sun, 11-May-2025 4:40 PM', 'North Melbourne'],
    ['Sat, 27-Sep-2025 2:30 PM', 'Geelong'],
  ])('%s (%s home) matches', (text, home) => {
    const { date, startUtc } = parsePageDateTime(text);
    const game = games.find((g) => g.date.startsWith(date) && g.hteam === home);
    expect(startUtc).toBe(new Date((game?.unixtime ?? 0) * 1000).toISOString());
  });
});
