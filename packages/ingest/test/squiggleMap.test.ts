import { SquiggleGamesResponse, SquiggleTeamsResponse, UnknownTeamError } from '@afl/core';
import { describe, expect, it } from 'vitest';
import { type ParsedMatchRow, parseMatchPage } from '../src/afltables/matchPage.ts';
import { parseSeasonPage } from '../src/afltables/seasonPage.ts';
import { parsePageDateTime } from '../src/afltables/time.ts';
import {
  applySquiggle,
  assertTeamsMapped,
  gameLocalDate,
  isComplete,
  SquiggleIndex,
  squiggleTeamId,
  startTimeWarning,
} from '../src/squiggle/map.ts';
import { MATCH_FIXTURES, readAfltables, readFixtureBytes } from './helpers.ts';

const games = SquiggleGamesResponse.parse(
  JSON.parse(readFixtureBytes('squiggle/games-2025.json').toString('utf8')),
).games;
const teams = SquiggleTeamsResponse.parse(
  JSON.parse(readFixtureBytes('squiggle/teams.json').toString('utf8')),
).teams;
const index = new SquiggleIndex(games);
const links = parseSeasonPage(readAfltables('seas-2025.html'), 2025);

function fixtureMatch(matchKey: string): ParsedMatchRow {
  const fixture = MATCH_FIXTURES.find((f) => f.matchKey === matchKey);
  if (!fixture) throw new Error(`no fixture ${matchKey}`);
  return parseMatchPage(readAfltables(`${fixture.name}.html`), fixture).match;
}

const byId = (id: number) => games.find((g) => g.id === id);

describe('joining AFL Tables matches to Squiggle games', () => {
  it.each(MATCH_FIXTURES.filter((f) => f.season === 2025))(
    '$matchKey joins to exactly one game on (local date, home, away)',
    ({ matchKey }) => {
      const match = fixtureMatch(matchKey);
      const key = {
        date: parsePageDateTime(match.local_time).date,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
      };
      const matching = games.filter(
        (g) =>
          gameLocalDate(g) === key.date &&
          squiggleTeamId(g.hteamid, g.hteam, '2025') === key.homeTeamId &&
          squiggleTeamId(g.ateamid, g.ateam, '2025') === key.awayTeamId,
      );
      expect(matching).toHaveLength(1);
      expect(index.find(key)).toBe(matching[0]);
    },
  );

  it('joins every one of the 216 season-page matches to a different game', () => {
    const ids = links.map((l) => index.find(l)?.id);
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(216);
  });

  it('warns about the start time only for R23 Fremantle v Brisbane Lions (15 Aug 2025)', () => {
    const warnings = links.flatMap((l) => {
      const game = index.find(l);
      const warning = game && startTimeWarning(l.matchKey, l.startUtc, game);
      return warning ? [warning] : [];
    });
    expect(warnings).toEqual([
      '081920250815: AFL Tables start 2025-08-15T10:35:00.000Z differs from Squiggle 2025-08-15T10:20:00.000Z by 15 min; using Squiggle',
    ]);
  });

  it('joins on the venue-local date, not Squiggle "date" (synthetic Perth game after 10 PM)', () => {
    const base = games.find((g) => g.venue === 'Perth Stadium') ?? games[0];
    if (!base) throw new Error('no game');
    const late = {
      ...base,
      localtime: '2025-07-12 22:20:00',
      date: '2025-07-13 00:20:00',
    };
    const lateIndex = new SquiggleIndex([late]);
    const home = squiggleTeamId(late.hteamid, late.hteam, 'test');
    const away = squiggleTeamId(late.ateamid, late.ateam, 'test');
    expect(lateIndex.find({ date: '2025-07-12', homeTeamId: home, awayTeamId: away })).toBe(late);
    expect(lateIndex.find({ date: '2025-07-13', homeTeamId: home, awayTeamId: away })).toBe(
      undefined,
    );
  });

  it('never joins with home and away swapped', () => {
    const link = links[0];
    if (!link) throw new Error('no link');
    expect(
      index.find({ date: link.date, homeTeamId: link.awayTeamId, awayTeamId: link.homeTeamId }),
    ).toBe(undefined);
  });

  it('throws on two games with the same key', () => {
    const [first] = games;
    if (!first) throw new Error('no game');
    expect(() => new SquiggleIndex([first, { ...first, id: 1 }])).toThrow(/2 Squiggle games/);
  });
});

describe('team mapping', () => {
  it('maps every Squiggle team in teams.json', () => {
    expect(() => assertTeamsMapped(teams)).not.toThrow();
  });

  it('throws an error that names an unmapped team', () => {
    const tasmania = { id: 19, name: 'Tasmania', abbrev: 'TAS', debut: 2028, retirement: 9999 };
    expect(() => assertTeamsMapped([...teams, tasmania])).toThrow(UnknownTeamError);
    expect(() => assertTeamsMapped([...teams, tasmania])).toThrow(
      'Unmapped Squiggle team 19 "Tasmania" (teams)',
    );
  });

  it('names the team and the season when a game has an unmapped team', () => {
    const [first] = games;
    if (!first) throw new Error('no game');
    const game = { ...first, ateamid: 19, ateam: 'Tasmania' };
    expect(() => new SquiggleIndex([game])).toThrow(
      'Unmapped Squiggle team 19 "Tasmania" (games 2025)',
    );
  });
});

describe('isComplete', () => {
  it('counts only complete === 100 as final', () => {
    const [first] = games;
    if (!first) throw new Error('no game');
    expect(isComplete(first)).toBe(true);
    expect(isComplete({ ...first, complete: 99 })).toBe(false);
    expect(isComplete({ ...first, complete: 0 })).toBe(false);
  });
});

describe('applySquiggle', () => {
  const joined = (matchKey: string) => {
    const match = fixtureMatch(matchKey);
    const game = index.find({
      date: parsePageDateTime(match.local_time).date,
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
    });
    return { match, game, ...applySquiggle(match, game) };
  };

  it('sets squiggle_id and start_utc from unixtime, and uses Squiggle round numbering', () => {
    const { match, game, row, warnings } = joined('141820250511');
    expect(match).toMatchObject({ round_no: 10, round_label: 'Round 10', squiggle_id: null });
    expect(row).toEqual({
      ...match,
      squiggle_id: game?.id,
      start_utc: '2025-05-11T03:10:00.000Z',
      round_no: 9,
      round_label: 'Round 9',
    });
    expect(warnings).toEqual([]);
  });

  it('renumbers R2 Essendon v Adelaide (page "Round 3")', () => {
    expect(joined('010520250322').row).toMatchObject({ round_no: 2, round_label: 'Round 2' });
  });

  it('keeps the AFL Tables label for a final', () => {
    const { row } = joined('091920250927');
    expect(row).toMatchObject({
      round_no: null,
      round_label: 'Grand Final',
      is_final: true,
      is_grand_final: true,
    });
    expect(row.squiggle_id).toBeGreaterThan(0);
  });

  it('calls round 0 the "Opening Round"', () => {
    const match: ParsedMatchRow = {
      ...fixtureMatch('141820250511'),
      match_id: '101620250307',
      round_label: 'Round 1',
      round_no: 1,
      home_team_id: 'sydney',
      away_team_id: 'hawthorn',
      local_time: 'Fri, 07-Mar-2025 7:40 PM',
      start_utc: '2025-03-07T08:40:00.000Z',
    };
    const { row } = applySquiggle(match, byId(37091));
    expect(row).toMatchObject({ round_no: 0, round_label: 'Opening Round', squiggle_id: 37091 });
  });

  it('prefers Squiggle unixtime over the page time, with a warning', () => {
    const match: ParsedMatchRow = {
      ...fixtureMatch('141820250511'),
      start_utc: '2025-05-11T03:25:00.000Z',
    };
    const game = index.find({
      date: '2025-05-11',
      homeTeamId: 'richmond',
      awayTeamId: 'west-coast',
    });
    const { row, warnings } = applySquiggle(match, game);
    expect(row.start_utc).toBe('2025-05-11T03:10:00.000Z');
    expect(warnings).toEqual([expect.stringMatching(/141820250511: .* by 15 min; using Squiggle/)]);
  });

  it('keeps the page values when there is no Squiggle game, with a warning', () => {
    const match = fixtureMatch('141820250511');
    const { row, warnings } = applySquiggle(match, undefined);
    expect(row).toEqual(match);
    expect(warnings).toEqual([
      '141820250511: no Squiggle game; keeping the AFL Tables round and page start time',
    ]);
  });

  it('warns when the sources disagree on whether the match is a final', () => {
    const { match, game } = joined('141820250511');
    if (!game) throw new Error('no game');
    const { row, warnings } = applySquiggle(match, { ...game, is_final: 2 });
    expect(row.round_no).toBe(10);
    expect(warnings).toEqual([
      expect.stringMatching(/141820250511: AFL Tables says home-and-away, Squiggle says final/),
    ]);
  });
});
