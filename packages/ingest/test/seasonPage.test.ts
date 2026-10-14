import { describe, expect, it } from 'vitest';
import { normaliseRound } from '../src/afltables/rounds.ts';
import { parseSeasonPage, SeasonPageError } from '../src/afltables/seasonPage.ts';
import { readAfltables } from './helpers.ts';

const FINALS_WEEK: Record<string, number> = {
  'Qualifying Final': 1,
  'Elimination Final': 1,
  'Semi Final': 2,
  'Preliminary Final': 3,
  'Grand Final': 4,
};

/** Sort rank of a round label: home-and-away rounds by number, then finals by week. */
function rank(label: string): number {
  const { roundNo } = normaliseRound(label);
  return roundNo ?? 100 + (FINALS_WEEK[label] ?? 0);
}

function countBy(labels: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of labels) counts[label] = (counts[label] ?? 0) + 1;
  return counts;
}

describe.each([
  { season: 2025, total: 216, rounds: 25 },
  { season: 2003, total: 185, rounds: 22 },
])('parseSeasonPage($season)', ({ season, total, rounds }) => {
  const links = parseSeasonPage(readAfltables(`seas-${season}.html`), season);
  const labels = links.map((l) => l.roundLabel);

  it(`returns ${total} unique match keys with absolute URLs`, () => {
    expect(links).toHaveLength(total);
    expect(new Set(links.map((l) => l.matchKey)).size).toBe(total);
    for (const { matchKey, url } of links) {
      expect(matchKey).toMatch(new RegExp(`^\\d{4}${season}\\d{4}$`));
      expect(url).toBe(`https://afltables.com/afl/stats/games/${season}/${matchKey}.html`);
    }
  });

  it('labels every match, in round order', () => {
    const ranks = labels.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const homeAndAway = Array.from({ length: rounds }, (_, i) => `Round ${i + 1}`);
    expect(new Set(labels)).toEqual(new Set([...homeAndAway, ...Object.keys(FINALS_WEEK)]));
  });

  it('labels the nine finals', () => {
    const finals = labels.filter((l) => normaliseRound(l).isFinal);
    expect(countBy(finals)).toEqual({
      'Qualifying Final': 2,
      'Elimination Final': 2,
      'Semi Final': 2,
      'Preliminary Final': 2,
      'Grand Final': 1,
    });
    expect(labels.slice(-9)).toEqual(finals);
  });
});

describe('parseSeasonPage(2025) details', () => {
  const links = parseSeasonPage(readAfltables('seas-2025.html'), 2025);

  it('starts with Opening Round, which AFL Tables numbers Round 1', () => {
    expect(links[0]).toEqual({
      matchKey: '101620250307',
      url: 'https://afltables.com/afl/stats/games/2025/101620250307.html',
      roundLabel: 'Round 1',
    });
  });

  it('keeps postponed games in their round block (page order, not date order)', () => {
    const round1 = links.filter((l) => l.roundLabel === 'Round 1').map((l) => l.matchKey);
    expect(round1).toContain('091920250329');
    expect(round1).toContain('052020250827');
  });

  it('lists the finals in page order and ends with the Grand Final', () => {
    expect(links.slice(-9).map((l) => l.roundLabel)).toEqual([
      'Qualifying Final',
      'Qualifying Final',
      'Elimination Final',
      'Elimination Final',
      'Semi Final',
      'Semi Final',
      'Preliminary Final',
      'Preliminary Final',
      'Grand Final',
    ]);
    expect(links.at(-1)?.matchKey).toBe('091920250927');
  });

  it('labels the match fixtures as their pages do', () => {
    const label = (key: string) => links.find((l) => l.matchKey === key)?.roundLabel;
    expect(label('141820250511')).toBe('Round 10');
    expect(label('121920250511')).toBe('Round 10');
    expect(label('010520250322')).toBe('Round 3');
    expect(label('091920250927')).toBe('Grand Final');
  });
});

describe('parseSeasonPage on synthetic pages', () => {
  const link = (path: string) => `<td>[<a href="${path}">Match stats</a>]</td>`;
  const heading = (label: string) =>
    `<table><tr><td align=center width=60%><b>${label}</td></tr></table>`;

  it('de-duplicates repeated links, keeping the first', () => {
    const html = `${heading('Round 1')}<table><tr>${link('../stats/games/2025/101620250307.html')}</tr></table>
      ${heading('Round 2')}<table><tr>${link('../stats/games/2025/101620250307.html')}${link('../stats/games/2025/010520250322.html')}</tr></table>`;
    expect(parseSeasonPage(html, 2025)).toEqual([
      {
        matchKey: '101620250307',
        url: 'https://afltables.com/afl/stats/games/2025/101620250307.html',
        roundLabel: 'Round 1',
      },
      {
        matchKey: '010520250322',
        url: 'https://afltables.com/afl/stats/games/2025/010520250322.html',
        roundLabel: 'Round 2',
      },
    ]);
  });

  it('ignores bold numbers that are not "Round N" headings', () => {
    const html = `${heading('Round 1')}<table><tr><td><b>7</b></td>${link('../stats/games/2025/101620250307.html')}</tr></table>`;
    expect(parseSeasonPage(html, 2025)[0]?.roundLabel).toBe('Round 1');
  });

  it('throws on a link to another season', () => {
    const html = `${heading('Round 1')}<table><tr>${link('../stats/games/2024/101620240307.html')}</tr></table>`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(SeasonPageError);
  });

  it('throws on a match link before any round heading', () => {
    const html = `<table><tr>${link('../stats/games/2025/101620250307.html')}</tr></table>`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(SeasonPageError);
  });

  it('throws when the page has no match links', () => {
    expect(() => parseSeasonPage(heading('Round 1'), 2025)).toThrow(SeasonPageError);
  });
});
