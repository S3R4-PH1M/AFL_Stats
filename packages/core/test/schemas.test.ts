import { describe, expect, it } from 'vitest';
import {
  LadderRow,
  MatchDetailFile,
  MatchRow,
  MetaFile,
  PlayerMatchRow,
  PlayerRow,
  QuarterRow,
  SeasonLadderFile,
  SeasonMatchesFile,
  type StatValues,
} from '../src/schemas.ts';
import { STAT_COLUMNS, STAT_DEFINITIONS } from '../src/stats.ts';
import { TEAMS } from '../src/teams.ts';

const stats = Object.fromEntries(STAT_COLUMNS.map((c) => [c, 0])) as StatValues;

// Shaped on R9 2025, Richmond 11.15 (81) v West Coast 11.13 (79); squiggle_id and times are illustrative.
const matchRow: MatchRow = {
  match_id: '141820250511',
  squiggle_id: 37162,
  season: 2025,
  round_label: 'Round 9',
  round_no: 9,
  is_final: false,
  is_grand_final: false,
  start_utc: '2025-05-11T03:20:00Z',
  local_time: 'Sun, 11-May-2025 1:20 PM',
  venue: 'M.C.G.',
  attendance: 29539,
  home_team_id: 'richmond',
  away_team_id: 'west-coast',
  home_score: 81,
  away_score: 79,
  source_fetched_at: '2026-10-14T04:00:00.000Z',
};

const playerRow: PlayerMatchRow = {
  match_id: '141820250511',
  player_id: 'T/Tom_Lynch1',
  team_id: 'richmond',
  jumper: 19,
  sub_status: null,
  ...stats,
};

const quarter = {
  quarter: 1,
  goals: 3,
  behinds: 2,
  points: 20,
  cumGoals: 3,
  cumBehinds: 2,
  cumPoints: 20,
};
const side = { teamId: 'richmond', goals: 11, behinds: 15, score: 81, quarters: [quarter] };
const summary = {
  matchId: '141820250511',
  squiggleId: 37162,
  season: 2025,
  roundNo: 9,
  roundLabel: 'Round 9',
  isFinal: false,
  isGrandFinal: false,
  startUtc: '2025-05-11T03:20:00Z',
  localTime: 'Sun, 11-May-2025 1:20 PM',
  venue: 'M.C.G.',
  attendance: 29539,
};

describe('parsed row schemas', () => {
  it('accepts valid rows', () => {
    expect(MatchRow.parse(matchRow)).toEqual(matchRow);
    expect(PlayerMatchRow.parse(playerRow)).toEqual(playerRow);
    expect(
      QuarterRow.parse({
        match_id: '141820250511',
        team_id: 'richmond',
        quarter: 5,
        goals: 1,
        behinds: 0,
        points: 6,
        cum_goals: 12,
        cum_behinds: 15,
        cum_points: 87,
      }),
    ).toBeTruthy();
  });

  it('accepts player ids with digits and hyphens, and NULL stats out of coverage', () => {
    for (const player_id of ['A/Alex_Neal-Bullen', 'L/Luke_Davies-Uniacke', 'J/Jack_Ross3']) {
      expect(PlayerMatchRow.safeParse({ ...playerRow, player_id }).success).toBe(true);
    }
    expect(PlayerMatchRow.safeParse({ ...playerRow, ga: null, sub_status: 'on' }).success).toBe(
      true,
    );
  });

  it.each([
    ['player_id with ..', { player_id: 'A/..' }],
    ['player_id without letter dir', { player_id: 'Tom_Lynch1' }],
    ['player_id with backslash', { player_id: 'T\\Tom' }],
    ['negative stat', { tk: -1 }],
    ['fractional count', { ki: 1.5 }],
    ['pct_played over 100', { pct_played: 101 }],
    ['bad sub_status', { sub_status: 'SU' }],
    ['unknown column', { su: 1 }],
  ])('rejects a player row with %s', (_, patch) => {
    expect(PlayerMatchRow.safeParse({ ...playerRow, ...patch }).success).toBe(false);
  });

  it.each([
    ['short match_id', { match_id: '1418' }],
    ['non-slug team', { home_team_id: 'Richmond' }],
    ['non-ISO start', { start_utc: '11 May 2025' }],
  ])('rejects a match row with %s', (_, patch) => {
    expect(MatchRow.safeParse({ ...matchRow, ...patch }).success).toBe(false);
  });

  const person: PlayerRow = {
    player_id: 'T/Tom_Lynch1',
    display_name: 'Tom Lynch',
    first_name: 'Tom',
    surname: 'Lynch',
  };

  it('accepts a player row, with NULL name parts when the page name has no comma', () => {
    expect(PlayerRow.parse(person)).toEqual(person);
    expect(PlayerRow.safeParse({ ...person, first_name: null, surname: null }).success).toBe(true);
  });

  it.each([
    ['bad player_id', { player_id: 'Tom_Lynch1' }],
    ['empty display_name', { display_name: '' }],
    ['empty first_name', { first_name: '' }],
    ['unknown key', { dob: '1993-04-10' }],
  ])('rejects a player row with %s', (_, patch) => {
    expect(PlayerRow.safeParse({ ...person, ...patch }).success).toBe(false);
  });
});

describe('published v1 schemas', () => {
  it('accepts meta.json built from core', () => {
    const meta = {
      version: 'v1',
      builtAt: '2026-10-14T04:00:00.000Z',
      seasons: [2025],
      teams: TEAMS.map(({ teamId, name, abbrev }) => ({ teamId, name, abbrev })),
      stats: STAT_DEFINITIONS.map((s) => ({ ...s })),
    };
    expect(MetaFile.parse(meta)).toEqual(meta);
    expect(MetaFile.safeParse({ ...meta, version: 'v2' }).success).toBe(false);
  });

  it('accepts ladder, matches and match detail files', () => {
    const ladderRow = {
      rank: 1,
      teamId: 'adelaide',
      played: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      pts: 4,
      pointsFor: 100,
      pointsAgainst: 80,
      percentage: 125,
    };
    expect(
      SeasonLadderFile.safeParse({ season: 2025, rounds: [{ roundNo: 1, rows: [ladderRow] }] })
        .success,
    ).toBe(true);
    // A team yet to play after Opening Round has 0 for and 0 against: no percentage.
    const unplayed = { ...ladderRow, played: 0, wins: 0, pts: 0, pointsFor: 0, pointsAgainst: 0 };
    expect(LadderRow.safeParse({ ...unplayed, percentage: null }).success).toBe(true);
    expect(LadderRow.safeParse({ ...unplayed, percentage: Number.NaN }).success).toBe(false);

    const match = { ...summary, home: side, away: { ...side, teamId: 'west-coast' } };
    expect(SeasonMatchesFile.safeParse({ season: 2025, matches: [match] }).success).toBe(true);

    const detailSide = {
      ...side,
      players: [
        {
          playerId: 'T/Tom_Lynch1',
          displayName: 'Lynch, Tom',
          jumper: 19,
          subStatus: null,
          stats,
        },
      ],
      totals: stats,
    };
    const detail = { ...summary, home: detailSide, away: { ...detailSide, teamId: 'west-coast' } };
    expect(MatchDetailFile.safeParse(detail).success).toBe(true);
    expect(MatchDetailFile.safeParse({ ...detail, extra: 1 }).success).toBe(false);
  });
});
