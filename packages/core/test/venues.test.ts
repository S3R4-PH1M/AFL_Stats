import { describe, expect, it } from 'vitest';
import { UnknownVenueError, VENUES, venueByAfltablesName } from '../src/venues.ts';
import { readFixture, readJsonFixture, uniqueMatches } from './fixtures.ts';

const venueNamePattern = /venues\/\w+\.html">([^<]+)</g;

describe('venues', () => {
  it('has unique AFL Tables names and valid IANA time zones', () => {
    expect(new Set(VENUES.map((v) => v.afltablesName)).size).toBe(VENUES.length);
    for (const v of VENUES) {
      expect(() => new Intl.DateTimeFormat('en-AU', { timeZone: v.timeZone })).not.toThrow();
      expect(v.timeZone).toMatch(/^Australia\//);
    }
  });

  it.each([
    [2025, 18],
    [2003, 11],
  ])('maps every venue on seas-%i.html', (season, venues) => {
    const names = uniqueMatches(readFixture(`afltables/seas-${season}.html`), venueNamePattern);
    expect(names).toHaveLength(venues);
    for (const n of names) expect(venueByAfltablesName(n).afltablesName).toBe(n);
  });

  it('maps every venue in Squiggle games-2025.json', () => {
    const games = readJsonFixture<{ games: { venue: string }[] }>('squiggle/games-2025.json').games;
    const names = [...new Set(games.map((g) => g.venue))];
    expect(names).toHaveLength(18);
    for (const n of names) expect(() => venueByAfltablesName(n)).not.toThrow();
  });

  it('throws a named error for an unknown venue', () => {
    expect(() => venueByAfltablesName('Wellington')).toThrow(UnknownVenueError);
    expect(() => venueByAfltablesName('Wellington')).toThrow(/"Wellington"/);
  });
});
