import { describe, expect, it } from 'vitest';
import { parseMatchPage } from '../src/afltables/matchPage.ts';
import { normaliseRound } from '../src/afltables/rounds.ts';
import { parseSeasonPage, SeasonPageError } from '../src/afltables/seasonPage.ts';
import { MATCH_FIXTURES, readAfltables } from './helpers.ts';

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

  it('matches the golden file', async () => {
    await expect(`${JSON.stringify(links, null, 2)}\n`).toMatchFileSnapshot(
      `./golden/seas-${season}.json`,
    );
  });

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

  it('gives each match fixture the home, away and venue-local date of its match page', () => {
    for (const { name, matchKey } of MATCH_FIXTURES.filter((f) => f.season === season)) {
      const { match } = parseMatchPage(readAfltables(`${name}.html`), { season, matchKey });
      const link = links.find((l) => l.matchKey === matchKey);
      expect(link).toMatchObject({
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
        date: `${matchKey.slice(4, 8)}-${matchKey.slice(8, 10)}-${matchKey.slice(10)}`,
        startUtc: match.start_utc,
      });
    }
  });

  it('dates every match on the day in its match key', () => {
    for (const { matchKey, date } of links)
      expect(date.replaceAll('-', '')).toBe(matchKey.slice(4));
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
      homeTeamId: 'sydney',
      awayTeamId: 'hawthorn',
      date: '2025-03-07',
      localTime: 'Fri 07-Mar-2025 7:40 PM',
      startUtc: '2025-03-07T08:40:00.000Z',
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

  it('reads R23 Fremantle v Brisbane Lions from its row (page start differs from Squiggle)', () => {
    expect(links.find((l) => l.matchKey === '081920250815')).toEqual({
      matchKey: '081920250815',
      url: 'https://afltables.com/afl/stats/games/2025/081920250815.html',
      roundLabel: 'Round 24',
      homeTeamId: 'fremantle',
      awayTeamId: 'brisbane-lions',
      date: '2025-08-15',
      localTime: 'Fri 15-Aug-2025 6:35 PM',
      startUtc: '2025-08-15T10:35:00.000Z',
    });
  });

  it('labels the match fixtures as their pages do', () => {
    const label = (key: string) => links.find((l) => l.matchKey === key)?.roundLabel;
    expect(label('141820250511')).toBe('Round 10');
    expect(label('121920250511')).toBe('Round 10');
    expect(label('010520250322')).toBe('Round 3');
    expect(label('091920250927')).toBe('Grand Final');
  });
});

describe('parseSeasonPage(2003) team names', () => {
  it('maps "Kangaroos" to North Melbourne', () => {
    const links = parseSeasonPage(readAfltables('seas-2003.html'), 2003);
    const kangaroos = links.filter(
      (l) => l.homeTeamId === 'north-melbourne' || l.awayTeamId === 'north-melbourne',
    );
    expect(kangaroos.length).toBeGreaterThanOrEqual(22);
  });
});

describe('parseSeasonPage on synthetic pages', () => {
  const heading = (label: string) =>
    `<table><tr><td align=center width=60%><b>${label}</td></tr></table>`;
  /** One match table as the season page draws it: home row (with the date), then away row (with the link). */
  const game = (
    path: string,
    { home = 'Sydney', away = 'Hawthorn', when = 'Fri 07-Mar-2025 7:40 PM' } = {},
  ) => `<table><tr><td><a href="../teams/a_idx.html">${home}</a></td><td><tt>11.10</tt></td><td>76</td><td>${when} <b>Att: </b>40,000 <b>Venue:</b> <a href="../venues/scg.html">S.C.G.</a></td></tr>
    <tr><td><a href="../teams/b_idx.html">${away}</a></td><td><tt>14.12</tt></td><td>96</td><td><b>${away}</b> won by <b>20 pts </b>[<a href="${path}">Match stats</a>]</td></tr></table>`;
  const ess = { home: 'Essendon', away: 'Adelaide', when: 'Sat 22-Mar-2025 1:20 PM (12:20 PM)' };

  it('de-duplicates repeated links, keeping the first', () => {
    const html = `${heading('Round 1')}${game('../stats/games/2025/101620250307.html')}
      ${heading('Round 2')}${game('../stats/games/2025/101620250307.html')}${game('../stats/games/2025/010520250322.html', ess)}`;
    expect(parseSeasonPage(html, 2025)).toEqual([
      {
        matchKey: '101620250307',
        url: 'https://afltables.com/afl/stats/games/2025/101620250307.html',
        roundLabel: 'Round 1',
        homeTeamId: 'sydney',
        awayTeamId: 'hawthorn',
        date: '2025-03-07',
        localTime: 'Fri 07-Mar-2025 7:40 PM',
        startUtc: '2025-03-07T09:40:00.000Z',
      },
      {
        matchKey: '010520250322',
        url: 'https://afltables.com/afl/stats/games/2025/010520250322.html',
        roundLabel: 'Round 2',
        homeTeamId: 'essendon',
        awayTeamId: 'adelaide',
        date: '2025-03-22',
        localTime: 'Sat 22-Mar-2025 1:20 PM',
        startUtc: '2025-03-22T02:20:00.000Z',
      },
    ]);
  });

  it('ignores bold numbers that are not "Round N" headings', () => {
    const html = `${heading('Round 1')}<table><tr><td><b>7</b></td></tr></table>${game('../stats/games/2025/101620250307.html')}`;
    expect(parseSeasonPage(html, 2025)[0]?.roundLabel).toBe('Round 1');
  });

  it.each(['Wildcard Final', 'Grand Final Replay', 'Round Robin'])(
    'throws on an unrecognised round heading %j instead of reusing the previous label',
    (label) => {
      const html = `${heading('Round 24')}${game('../stats/games/2025/101620250307.html')}
      ${heading(label)}${game('../stats/games/2025/010520250322.html', ess)}`;
      expect(() => parseSeasonPage(html, 2025)).toThrow(/unrecognised round heading/);
    },
  );

  it('accepts a match link with a query or fragment, and drops it from the URL', () => {
    const html = `${heading('Round 1')}${game('../stats/games/2025/101620250307.html#p0')}${game('../stats/games/2025/010520250322.html?x=1', ess)}`;
    expect(parseSeasonPage(html, 2025).map((l) => l.url)).toEqual([
      'https://afltables.com/afl/stats/games/2025/101620250307.html',
      'https://afltables.com/afl/stats/games/2025/010520250322.html',
    ]);
  });

  it('throws on a link to another season', () => {
    const html = `${heading('Round 1')}${game('../stats/games/2024/101620240307.html', { when: 'Thu 07-Mar-2024 7:40 PM' })}`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(SeasonPageError);
  });

  it('throws on a match link before any round heading', () => {
    const html = game('../stats/games/2025/101620250307.html');
    expect(() => parseSeasonPage(html, 2025)).toThrow(SeasonPageError);
  });

  it('throws when a match table does not have exactly two team rows', () => {
    const html = `${heading('Round 1')}<table><tr><td>[<a href="../stats/games/2025/101620250307.html">Match stats</a>]</td></tr></table>`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(/101620250307: expected 2 team rows/);
  });

  it('throws, naming the team and season, on an unmapped team', () => {
    const html = `${heading('Round 1')}${game('../stats/games/2025/101620250307.html', { home: 'Tasmania' })}`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(/"Tasmania" in season 2025/);
  });

  it('throws on an unreadable date', () => {
    const html = `${heading('Round 1')}${game('../stats/games/2025/101620250307.html', { when: 'TBC' })}`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(/101620250307: .*"TBC"/);
  });

  it('throws when the date is not the day in the match key', () => {
    const html = `${heading('Round 1')}${game('../stats/games/2025/101620250307.html', { when: 'Sat 08-Mar-2025 7:40 PM' })}`;
    expect(() => parseSeasonPage(html, 2025)).toThrow(/date 2025-03-08 does not match/);
  });

  it('throws when the page has no match links', () => {
    expect(() => parseSeasonPage(heading('Round 1'), 2025)).toThrow(SeasonPageError);
  });
});
