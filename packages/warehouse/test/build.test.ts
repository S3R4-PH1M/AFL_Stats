import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BuildReport, buildWarehouse } from '../src/build.ts';
import { closeDb, type Db, openDb, queryRows } from '../src/db.ts';
import { runSqlTests, type SqlTestResult } from '../src/tests.ts';
import { buildFixtureDb, FIXTURE_FETCHED_AT, FIXTURE_URLS, fixtureCache } from './fixtureCache.ts';

/** Builds a fresh in-memory warehouse from a subset of the fixtures. */
async function buildFrom(paths: string[], seasons?: number[]): Promise<BuildReport> {
  const { cache, cleanup } = await fixtureCache(paths);
  const fresh = await openDb(':memory:');
  try {
    return await buildWarehouse({ conn: fresh.conn, cache, seasons });
  } finally {
    closeDb(fresh);
    await cleanup();
  }
}

describe('db:build options and partial caches', () => {
  it('loads a season named twice only once', async () => {
    const report = await buildFrom(Object.keys(FIXTURE_URLS), [2025, 2025]);
    expect(report.seasons).toEqual([2025]);
    expect(report.matches).toBe(4);
  });

  it('names the Squiggle response that is missing (standings, with games cached)', async () => {
    const paths = Object.keys(FIXTURE_URLS).filter((p) => p !== 'squiggle/standings-2025.json');
    const report = await buildFrom(paths, [2025]);
    expect(report.warnings.filter((w) => w.includes('Squiggle'))).toEqual([
      '2025: Squiggle standings not cached; run npm run ingest -- --season 2025',
    ]);
  });
});

let db: Db;
let report: BuildReport;
let results: SqlTestResult[];

beforeAll(async () => {
  ({ db, report } = await buildFixtureDb());
  results = await runSqlTests(db.conn);
});
afterAll(() => {
  if (db) closeDb(db);
});

const one = async (sql: string) => (await queryRows(db.conn, sql))[0] ?? {};

describe('db:build from the fixtures (in-memory DuckDB)', () => {
  it('passes every SQL data test; the ladder-vs-Squiggle test is skipped (partial season)', () => {
    const failed = results.filter((r) => r.status === 'fail');
    expect(failed.map((r) => ({ name: r.name, sample: r.sample }))).toEqual([]);
    expect(results.filter((r) => r.status === 'skip').map((r) => r.name)).toEqual([
      '090_ladder_vs_squiggle',
    ]);
    expect(results.map((r) => r.name)).toEqual([
      '010_player_match_unique',
      '020_goals_behinds_reconcile',
      '030_score_formula_and_squiggle',
      '040_quarters_cumulative',
      '050_disposals',
      '060_teams_and_sizes',
      '070_squiggle_joined',
      '080_brownlow_votes',
      '090_ladder_vs_squiggle',
      'G1_no_negatives',
      'G2_coverage_no_null',
      'G3_totals_equal_players',
    ]);
  });

  it('loads both cached seasons and reports the uncached season-page matches', () => {
    expect(report.seasons).toEqual([2003, 2025]);
    expect(report.matches).toBe(5);
    expect(report.notCached).toHaveLength(212 + 184);
  });

  it('loads every parsed row', async () => {
    expect(
      await one(`SELECT
        (SELECT count(*) FROM team) AS teams,
        (SELECT count(*) FROM stat_definition) AS stats,
        (SELECT count(*) FROM match) AS matches,
        (SELECT count(*) FROM match_quarter) AS quarters,
        (SELECT count(*) FROM player_match) AS player_matches,
        (SELECT count(*) FROM player) AS players,
        (SELECT count(*) FROM team_match_totals) AS totals,
        (SELECT count(*) FROM squiggle_game) AS games,
        (SELECT count(*) FROM squiggle_standing) AS standings`),
    ).toEqual({
      teams: 18n,
      stats: 23n,
      matches: 5n,
      quarters: 40n,
      player_matches: 228n,
      players: 209n,
      totals: 10n,
      games: 216n,
      standings: 18n,
    });
  });

  it('joins the 2025 matches to Squiggle (start from unixtime, Squiggle rounds) but not 2003', async () => {
    const rows = await queryRows(
      db.conn,
      `SELECT match_id, squiggle_id IS NOT NULL AS joined, round_no, round_label,
        start_utc, local_date, source_fetched_at
       FROM match ORDER BY match_id`,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        match_id: '010320030629',
        joined: false,
        round_no: 13,
        round_label: 'Round 13',
      }),
      expect.objectContaining({ match_id: '010520250322', joined: true, round_no: 2 }),
      expect.objectContaining({
        match_id: '091920250927',
        joined: true,
        round_no: null,
        round_label: 'Grand Final',
      }),
      expect.objectContaining({ match_id: '121920250511', joined: true, round_no: 9 }),
      expect.objectContaining({
        match_id: '141820250511',
        joined: true,
        round_no: 9,
        round_label: 'Round 9',
        start_utc: new Date('2025-05-11T03:10:00.000Z'),
        local_date: new Date('2025-05-11T00:00:00.000Z'),
      }),
    ]);
    for (const row of rows) {
      expect(row.source_fetched_at).toEqual(new Date(FIXTURE_FETCHED_AT));
    }
    expect(report.warnings).toContain(
      '010320030629: no Squiggle game; keeping the AFL Tables round and page start time',
    );
    expect(report.warnings).toContain(
      '2003: Squiggle games not cached; run npm run ingest -- --season 2003',
    );
    expect(report.warnings).toContain(
      '2003: Squiggle standings not cached; run npm run ingest -- --season 2003',
    );
    expect(report.warnings.filter((w) => w.startsWith('2025: Squiggle'))).toEqual([]);
  });

  it('keeps the rushed behinds and the Totals row for reconciliation', async () => {
    expect(
      await one(`SELECT rushed_behinds, gl, bh, di FROM team_match_totals
        WHERE match_id = '010320030629' AND team_id = 'carlton'`),
    ).toEqual({ rushed_behinds: 3, gl: 7, bh: 8, di: 226 });
    expect(
      await one(`SELECT players, gl, di FROM team_match
        WHERE match_id = '010320030629' AND team_id = 'carlton'`),
    ).toEqual({ players: 22n, gl: 7n, di: 226n });
  });

  it('keeps one player row per player across matches', async () => {
    // Brisbane Lions play in both the draw and the Grand Final.
    expect(
      await one(`SELECT count(DISTINCT match_id) AS matches FROM player_match
        WHERE player_id = (SELECT player_id FROM player_match
          WHERE team_id = 'brisbane-lions' GROUP BY player_id HAVING count(*) = 2 LIMIT 1)`),
    ).toEqual({ matches: 2n });
  });

  it('builds the ladder for every 2025 round present, with every team in each', async () => {
    const rows = await queryRows(
      db.conn,
      `SELECT round_no, count(*) AS teams, sum(played) AS played
       FROM ladder_round WHERE season = 2025 GROUP BY round_no ORDER BY round_no`,
    );
    expect(rows).toEqual([
      { round_no: 2, teams: 6n, played: 2n },
      { round_no: 9, teams: 6n, played: 6n }, // R2's 2 team-games carry over, plus R9's 4
    ]);
    expect(
      await queryRows(
        db.conn,
        `SELECT team_id, rank, played, wins, losses, draws, pts, points_for, points_against, percentage
         FROM ladder_round WHERE season = 2025 AND round_no = 9 ORDER BY rank`,
      ),
    ).toEqual([
      expect.objectContaining({ team_id: 'adelaide', rank: 1, pts: 4, percentage: 161 }),
      expect.objectContaining({ team_id: 'richmond', rank: 2, pts: 4, percentage: 102.53 }),
      expect.objectContaining({ team_id: 'brisbane-lions', rank: 3, pts: 2, draws: 1 }),
      expect.objectContaining({ team_id: 'north-melbourne', rank: 4, pts: 2, draws: 1 }),
      expect.objectContaining({ team_id: 'west-coast', rank: 5, pts: 0, percentage: 97.53 }),
      expect.objectContaining({ team_id: 'essendon', rank: 6, pts: 0, percentage: 62.11 }),
    ]);
  });
});
