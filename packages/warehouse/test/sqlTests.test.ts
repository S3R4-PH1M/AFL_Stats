import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, type Db } from '../src/db.ts';
import { reportSqlTests, runSqlTests, type SqlTestResult } from '../src/tests.ts';
import { buildFixtureDb } from './fixtureCache.ts';

/**
 * Each data test must catch the fault it exists for, so none is vacuous: every case breaks the
 * fixture warehouse in one way (inside a rolled-back transaction) and lists the tests that fail.
 */
let db: Db;
beforeAll(async () => {
  ({ db } = await buildFixtureDb());
});
afterAll(() => {
  if (db) closeDb(db);
});

const RICHMOND_WC = "match_id = '141820250511'";
/** A Richmond player with a goal, a tackle and contested possessions in the R9 fixture. */
const PLAYER = `${RICHMOND_WC} AND player_id = (SELECT min(player_id) FROM player_match WHERE ${RICHMOND_WC} AND team_id = 'richmond' AND gl > 0 AND tk > 0 AND cp > 0)`;

async function failingAfter(mutation: string): Promise<SqlTestResult[]> {
  await db.conn.run('BEGIN TRANSACTION');
  try {
    await db.conn.run(mutation);
    return (await runSqlTests(db.conn)).filter((r) => r.status === 'fail');
  } finally {
    await db.conn.run('ROLLBACK');
  }
}

describe('each SQL data test catches its fault', () => {
  it.each([
    [
      'a duplicated player row',
      "CREATE OR REPLACE TABLE player_match AS SELECT * FROM player_match UNION ALL (SELECT * FROM player_match WHERE match_id = '010320030629' AND gl = 0 AND bh = 0 AND br = 0 LIMIT 1)",
      // 23 players is still a legal team size, so only the key and the totals catch it.
      ['010_player_match_unique', 'G3_totals_equal_players'],
    ],
    [
      'a goal credited to the wrong player total',
      `UPDATE player_match SET gl = gl + 1 WHERE ${PLAYER}`,
      ['020_goals_behinds_reconcile', 'G3_totals_equal_players'],
    ],
    [
      'a Squiggle score that differs',
      `UPDATE squiggle_game SET home_score = home_score + 1 WHERE squiggle_id = (SELECT squiggle_id FROM match WHERE ${RICHMOND_WC})`,
      ['030_score_formula_and_squiggle'],
    ],
    [
      'a final score that differs from 6G + B',
      `UPDATE match SET home_score = home_score + 6 WHERE ${RICHMOND_WC}`,
      ['030_score_formula_and_squiggle', '040_quarters_cumulative'],
    ],
    [
      'a quarter cumulative that does not add up',
      `UPDATE match_quarter SET cum_points = cum_points + 1 WHERE ${RICHMOND_WC} AND quarter = 2`,
      ['040_quarters_cumulative'],
    ],
    [
      'a missing quarter',
      `DELETE FROM match_quarter WHERE ${RICHMOND_WC} AND quarter = 3`,
      ['040_quarters_cumulative'],
    ],
    [
      'disposals that are not kicks + handballs',
      `UPDATE player_match SET di = di + 1 WHERE ${PLAYER}`,
      ['050_disposals', 'G3_totals_equal_players'],
    ],
    [
      'a team with 21 players (2003: 22 a side, no substitute)',
      "DELETE FROM player_match WHERE match_id = '010320030629' AND player_id = (SELECT min(player_id) FROM player_match WHERE match_id = '010320030629' AND team_id = 'carlton' AND gl > 0)",
      ['020_goals_behinds_reconcile', '060_teams_and_sizes', 'G3_totals_equal_players'],
    ],
    [
      'a 2025 match not joined to Squiggle',
      `UPDATE match SET squiggle_id = NULL WHERE ${RICHMOND_WC}`,
      ['070_squiggle_joined'],
    ],
    [
      'a Squiggle game joined to the wrong date',
      `UPDATE match SET local_date = local_date + 1 WHERE ${RICHMOND_WC}`,
      ['070_squiggle_joined'],
    ],
    [
      'a Brownlow vote missing for one player',
      `UPDATE player_match SET br = NULL WHERE ${PLAYER}`,
      ['080_brownlow_votes'],
    ],
    [
      'Brownlow votes unpublished after the Grand Final is loaded',
      `UPDATE player_match SET br = NULL WHERE ${RICHMOND_WC}`,
      ['080_brownlow_votes', 'G3_totals_equal_players'],
    ],
    [
      'a negative stat',
      `UPDATE player_match SET tk = -1 WHERE ${PLAYER}`,
      ['G1_no_negatives', 'G3_totals_equal_players'],
    ],
    [
      'a NULL inside the stat coverage',
      `UPDATE player_match SET cp = NULL WHERE ${PLAYER}`,
      ['G2_coverage_no_null', 'G3_totals_equal_players'],
    ],
    [
      'a value before the stat coverage starts',
      "UPDATE stat_definition SET first_season = 2004 WHERE column_name = 'ga'",
      ['G2_coverage_no_null'],
    ],
    [
      'a Totals row that differs from its players',
      `UPDATE team_match_totals SET ki = ki + 1 WHERE ${RICHMOND_WC} AND team_id = 'richmond'`,
      ['G3_totals_equal_players'],
    ],
  ])('%s', async (_, mutation, expected) => {
    const failing = await failingAfter(mutation);
    expect(failing.map((r) => r.name)).toEqual(expected);
    for (const r of failing) expect(r.sample.length).toBeGreaterThan(0);
  });

  it('passes again after each rollback', async () => {
    expect((await runSqlTests(db.conn)).filter((r) => r.status === 'fail')).toEqual([]);
  });
});

describe('reportSqlTests (db:test output)', () => {
  const result = (name: string, status: SqlTestResult['status'], failing = 0): SqlTestResult => ({
    name,
    description: `${name} description`,
    status,
    failing,
    sample: Array.from({ length: Math.min(failing, 10) }, (_, i) => ({
      match_id: '141820250511',
      n: BigInt(i),
      at: new Date('2025-05-11T03:10:00.000Z'),
    })),
  });

  it('prints up to 10 failing rows per test and exits 1 on any failure', () => {
    const lines: string[] = [];
    const code = reportSqlTests(
      [result('010_a', 'pass'), result('020_b', 'fail', 12), result('090_c', 'skip')],
      (l) => lines.push(l),
    );
    expect(code).toBe(1);
    expect(lines[0]).toBe('  pass  010_a');
    expect(lines[1]).toBe('  FAIL  020_b  (12 rows)');
    expect(lines[2]).toBe('        020_b description');
    expect(lines[3]).toBe(
      '        {"match_id":"141820250511","n":0,"at":"2025-05-11T03:10:00.000Z"}',
    );
    expect(lines.filter((l) => l.startsWith('        {'))).toHaveLength(10);
    expect(lines).toContain('        … and 2 more');
    expect(lines).toContain('  skip  090_c  (precondition not met)');
    expect(lines.at(-1)).toBe('3 SQL tests: 1 passed, 1 failed, 1 skipped');
  });

  it('exits 0 when nothing fails', () => {
    expect(reportSqlTests([result('010_a', 'pass'), result('090_c', 'skip')], () => {})).toBe(0);
  });
});
