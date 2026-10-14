import {
  type SquiggleGame,
  SquiggleGamesResponse,
  type SquiggleStanding,
  SquiggleStandingsResponse,
} from '@afl/core';
import { gameJoinKey, unixtimeIso } from '@afl/ingest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, runModels } from '../src/build.ts';
import { closeDb, type Db, type DuckDBValue, insertRows, openDb, queryRows } from '../src/db.ts';
import { COLUMNS, LoadBatch } from '../src/load.ts';
import { loadSqlTests, runSqlTest } from '../src/tests.ts';
import { readJsonFixture } from './fixtureCache.ts';

/**
 * The ladder model against a whole season: every 2025 result from `games-2025.json` is loaded as
 * a `match` row (no players), so the derived final ladder can be checked against
 * `standings-2025.json` by data test 090, which the fixture build has to skip.
 */
const games = SquiggleGamesResponse.parse(readJsonFixture('squiggle/games-2025.json')).games;
const standings = SquiggleStandingsResponse.parse(
  readJsonFixture('squiggle/standings-2025.json'),
).standings;

function matchRow(g: SquiggleGame): DuckDBValue[] {
  const final = g.is_final > 0;
  const key = gameJoinKey(g);
  if (!key) throw new Error(`game ${g.id} has no teams`);
  return [
    String(g.id).padStart(12, '0'),
    g.id,
    g.year,
    g.roundname,
    final ? null : g.round,
    final,
    g.is_grand_final === 1,
    unixtimeIso(g),
    key.date,
    g.localtime,
    g.venue,
    null,
    key.homeTeamId,
    key.awayTeamId,
    g.hscore,
    g.ascore,
    '2026-10-14T00:00:00.000Z',
  ];
}

/** Squiggle games and standings, plus a `match` row for each of `loaded` (default: every game). */
async function seasonDb(
  allGames: readonly SquiggleGame[],
  allStandings: readonly SquiggleStanding[],
  loaded: readonly SquiggleGame[] = allGames,
): Promise<Db> {
  const db = await openDb(':memory:');
  await applySchema(db.conn);
  const batch = new LoadBatch();
  batch.seed();
  batch.addSquiggle(2025, allGames, allStandings);
  await batch.insert(db.conn);
  await insertRows(db.conn, 'match', COLUMNS.match, loaded.map(matchRow));
  await runModels(db.conn);
  return db;
}

async function ladderTest(db: Db) {
  const test = (await loadSqlTests(db.conn)).find((t) => t.name === '090_ladder_vs_squiggle');
  if (!test) throw new Error('no ladder test');
  return runSqlTest(db.conn, test);
}

let db: Db;
beforeAll(async () => {
  db = await seasonDb(games, standings);
});
afterAll(() => {
  if (db) closeDb(db);
});

describe('010_ladder_round over the full 2025 season', () => {
  it('marks 2025 fully loaded, so the ladder test runs and passes', async () => {
    expect(await queryRows(db.conn, 'SELECT * FROM season_load')).toEqual([
      {
        season: 2025,
        squiggle_games: 207n,
        squiggle_complete: 207n,
        loaded: 207n,
        fully_loaded: true,
      },
    ]);
    expect(await ladderTest(db)).toMatchObject({ status: 'pass', failing: 0 });
  });

  it('has a ladder after each of the 25 rounds (Opening Round = 0), all 18 teams in each', async () => {
    const rows = await queryRows(
      db.conn,
      'SELECT min(round_no) AS first, max(round_no) AS last, count(DISTINCT round_no) AS rounds, count(*) AS rows FROM ladder_round',
    );
    expect(rows).toEqual([{ first: 0, last: 24, rounds: 25n, rows: 450n }]);
  });

  it('gives teams idle in the Opening Round a row with nothing played', async () => {
    // Squiggle files the two postponed Opening Round games under the rounds they were played in
    // (Brisbane Lions v Geelong in round 3), so round 0 has 2 games; AFL Tables keeps all 4.
    const rows = await queryRows(
      db.conn,
      'SELECT count(*) FILTER (WHERE played = 0) AS idle, count(*) FILTER (WHERE played = 1) AS played, count(*) FILTER (WHERE percentage IS NULL) AS no_pct FROM ladder_round WHERE round_no = 0',
    );
    expect(rows).toEqual([{ idle: 14n, played: 4n, no_pct: 14n }]);
  });

  it('awards 2 points each for the North Melbourne v Brisbane Lions draw (round 9)', async () => {
    const rows = await queryRows(
      db.conn,
      `SELECT a.team_id, a.draws - b.draws AS draws, a.pts - b.pts AS pts
       FROM ladder_round a JOIN ladder_round b USING (season, team_id)
       WHERE a.round_no = 9 AND b.round_no = 8 AND a.team_id IN ('north-melbourne', 'brisbane-lions')
       ORDER BY a.team_id`,
    );
    expect(rows).toEqual([
      { team_id: 'brisbane-lions', draws: 1, pts: 2 },
      { team_id: 'north-melbourne', draws: 1, pts: 2 },
    ]);
  });

  it('matches the final standings: Adelaide first on 72 points', async () => {
    expect(
      await queryRows(
        db.conn,
        'SELECT team_id, rank, pts, points_for, points_against, percentage FROM ladder_round WHERE round_no = 24 AND rank = 1',
      ),
    ).toEqual([
      {
        team_id: 'adelaide',
        rank: 1,
        pts: 72,
        points_for: 2278,
        points_against: 1635,
        percentage: 139.33,
      },
    ]);
  });

  it('fails when one score differs from Squiggle', async () => {
    await db.conn.run('BEGIN TRANSACTION');
    try {
      await db.conn.run(
        'UPDATE match SET home_score = home_score + 1 WHERE match_id = (SELECT min(match_id) FROM match WHERE NOT is_final)',
      );
      await runModels(db.conn);
      const result = await ladderTest(db);
      expect(result.status).toBe('fail');
      expect(result.failing).toBeGreaterThanOrEqual(1);
    } finally {
      await db.conn.run('ROLLBACK');
    }
  });

  it('is skipped when a home-and-away match is not loaded', async () => {
    const missing = games.find((g) => g.is_final === 0)?.id;
    const partial = await seasonDb(
      games,
      standings,
      games.filter((g) => g.id !== missing),
    );
    try {
      expect(await ladderTest(partial)).toMatchObject({ status: 'skip' });
    } finally {
      closeDb(partial);
    }
  });
});
