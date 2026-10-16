import { STAT_DEFINITIONS, TEAMS } from '@afl/core';
import { closeDb, type Db } from '@afl/warehouse';
import { buildFixtureDb } from '@afl/warehouse/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  queryMatchDetails,
  queryMeta,
  querySeasonLadder,
  querySeasonMatches,
  querySeasons,
} from '../src/queries.ts';

let db: Db;
beforeAll(async () => {
  ({ db } = await buildFixtureDb());
});
afterAll(() => {
  if (db) closeDb(db);
});

describe('querySeasons and queryMeta (fixture warehouse)', () => {
  it('lists the seasons with a loaded match', async () => {
    expect(await querySeasons(db.conn)).toEqual([2003, 2025]);
  });

  it('builds meta.json from team, stat_definition and the latest fetch', async () => {
    const meta = await queryMeta(db.conn);
    expect(meta.version).toBe('v1');
    expect(meta.dataAsOf).toBe('2026-10-14T00:00:00.000Z');
    expect(meta.seasons).toEqual([2003, 2025]);
    expect(meta.teams).toHaveLength(TEAMS.length);
    expect(meta.teams.map((t) => t.name)).toEqual(TEAMS.map((t) => t.name).sort());
    expect(meta.stats).toEqual(STAT_DEFINITIONS.map((s) => ({ ...s })));
  });
});

describe('querySeasonLadder (fixture warehouse)', () => {
  it('has one labelled round per loaded home-and-away round, ranked', async () => {
    const ladder = await querySeasonLadder(db.conn, 2025);
    expect(ladder.season).toBe(2025);
    expect(ladder.rounds.map((r) => [r.roundNo, r.roundLabel])).toEqual([
      [2, 'Round 2'],
      [9, 'Round 9'],
    ]);
    for (const round of ladder.rounds) {
      expect(round.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('maps a ladder row, with null percentage before a team has played', async () => {
    const [round2] = (await querySeasonLadder(db.conn, 2025)).rounds;
    expect(round2?.rows[0]).toEqual({
      rank: 1,
      teamId: 'adelaide',
      played: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      pts: 4,
      pointsFor: 161,
      pointsAgainst: 100,
      percentage: 161,
    });
    expect(round2?.rows[1]).toMatchObject({ teamId: 'essendon', percentage: 62.11 });
    const unplayed = round2?.rows.filter((r) => r.played === 0) ?? [];
    expect(unplayed.map((r) => r.teamId)).toEqual([
      'brisbane-lions',
      'north-melbourne',
      'richmond',
      'west-coast',
    ]);
    for (const row of unplayed) expect(row.percentage).toBeNull();
  });

  it('keeps the AFL Tables round for a season without Squiggle data', async () => {
    const ladder = await querySeasonLadder(db.conn, 2003);
    expect(ladder.rounds.map((r) => [r.roundNo, r.roundLabel, r.rows.length])).toEqual([
      [13, 'Round 13', 2],
    ]);
  });
});

describe('querySeasonMatches (fixture warehouse)', () => {
  it('orders by round, then start time, with finals last', async () => {
    const { season, matches } = await querySeasonMatches(db.conn, 2025);
    expect(season).toBe(2025);
    expect(matches.map((m) => [m.matchId, m.roundNo, m.roundLabel])).toEqual([
      ['010520250322', 2, 'Round 2'],
      ['141820250511', 9, 'Round 9'],
      ['121920250511', 9, 'Round 9'],
      ['091920250927', null, 'Grand Final'],
    ]);
  });

  it('maps a match summary with goals and behinds from the final quarter', async () => {
    const { matches } = await querySeasonMatches(db.conn, 2025);
    const m = matches.find((x) => x.matchId === '141820250511');
    expect(m).toMatchObject({
      squiggleId: 37168,
      season: 2025,
      isFinal: false,
      isGrandFinal: false,
      startUtc: '2025-05-11T03:10:00.000Z',
      venue: 'M.C.G.',
      attendance: 29539,
      home: { teamId: 'richmond', goals: 11, behinds: 15, score: 81 },
      away: { teamId: 'west-coast', goals: 11, behinds: 13, score: 79 },
    });
    expect(m?.home.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4]);
    expect(m?.home.quarters.at(-1)).toMatchObject({ cumGoals: 11, cumBehinds: 15, cumPoints: 81 });
  });

  it('marks the Grand Final and has no Squiggle id in 2003', async () => {
    const gf = (await querySeasonMatches(db.conn, 2025)).matches.at(-1);
    expect(gf).toMatchObject({ isFinal: true, isGrandFinal: true, roundNo: null });
    const [m2003] = (await querySeasonMatches(db.conn, 2003)).matches;
    expect(m2003).toMatchObject({ matchId: '010320030629', squiggleId: null, roundNo: 13 });
  });

  it('keeps the draw level', async () => {
    const draw = (await querySeasonMatches(db.conn, 2025)).matches.find(
      (x) => x.matchId === '121920250511',
    );
    expect(draw?.home.score).toBe(71);
    expect(draw?.away.score).toBe(71);
  });
});

describe('queryMatchDetails (fixture warehouse)', () => {
  it('has one file per match, in matches.json order', async () => {
    const details = await queryMatchDetails(db.conn, 2025);
    const { matches } = await querySeasonMatches(db.conn, 2025);
    expect(details.map((d) => d.matchId)).toEqual(matches.map((m) => m.matchId));
  });

  it('has both box scores, ordered by jumper, with the Totals row and rushed behinds', async () => {
    const detail = (await queryMatchDetails(db.conn, 2025)).find(
      (d) => d.matchId === '141820250511',
    );
    if (!detail) throw new Error('missing match');
    expect(detail.home.players).toHaveLength(23);
    expect(detail.away.players).toHaveLength(23);
    const jumpers = detail.home.players.map((p) => p.jumper ?? Number.POSITIVE_INFINITY);
    expect(jumpers).toEqual([...jumpers].sort((a, b) => a - b));
    expect(detail.home.totals).toMatchObject({ ki: 191, gl: 11, bh: 15, pct_played: null });
    expect(detail.home.rushedBehinds).toBe(4);
    expect(detail.away.rushedBehinds).toBe(2);
    const lynch = detail.home.players.find((p) => p.playerId === 'T/Tom_Lynch1');
    expect(lynch).toMatchObject({ displayName: 'Tom Lynch', subStatus: null });
    // Σ player BH + rushed = the Totals row's BH.
    const playerBh = detail.home.players.reduce((n, p) => n + (p.stats.bh ?? 0), 0);
    expect(playerBh + detail.home.rushedBehinds).toBe(detail.home.totals.bh);
    expect(detail.home.players.filter((p) => p.subStatus !== null)).toHaveLength(2);
  });

  it('has 22 players a side in 2003, with no subs', async () => {
    const [detail] = await queryMatchDetails(db.conn, 2003);
    expect(detail?.home.players).toHaveLength(22);
    expect(detail?.away.players).toHaveLength(22);
    expect(detail?.home.players.every((p) => p.subStatus === null)).toBe(true);
  });
});
