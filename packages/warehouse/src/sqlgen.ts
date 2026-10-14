/**
 * SQL generated from the `stat_definition` table (proposal §9 "code generation", task 9.8), so a
 * new stat needs one metadata row, not edits to every view and test.
 *
 * Read from the database rather than `core/stats.ts`, so it reflects exactly what was loaded.
 */
import { type DuckDBConnection, queryRows } from './db.ts';

export interface StatColumnDef {
  column: string;
  firstSeason: number;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export async function statColumns(conn: DuckDBConnection): Promise<StatColumnDef[]> {
  const rows = await queryRows(
    conn,
    'SELECT column_name, first_season FROM stat_definition ORDER BY display_order',
  );
  return rows.map((r) => {
    const column = String(r.column_name);
    // Interpolated into SQL below, so only plain identifiers are allowed.
    if (!IDENTIFIER.test(column)) throw new Error(`Unsafe stat column name "${column}"`);
    return { column, firstSeason: Number(r.first_season) };
  });
}

/** `team_match`: Σ player_match per (match, team), one column per stat (§7). */
export function teamMatchViewSql(stats: readonly StatColumnDef[]): string {
  const sums = stats.map(({ column }) => `  sum(${column}) AS ${column}`).join(',\n');
  return `CREATE OR REPLACE VIEW team_match AS
SELECT match_id, team_id, count(*) AS players,
${sums}
FROM player_match
GROUP BY match_id, team_id`;
}

export interface GeneratedTest {
  name: string;
  description: string;
  sql: string;
}

/** Non-stat columns that must never be negative either. */
const OTHER_COUNTS: readonly (readonly [table: string, key: string, column: string])[] = [
  ['match', 'match_id', 'home_score'],
  ['match', 'match_id', 'away_score'],
  ['match', 'match_id', 'attendance'],
  ['team_match_totals', "match_id || ' ' || team_id", 'rushed_behinds'],
  ...['goals', 'behinds', 'points', 'cum_goals', 'cum_behinds', 'cum_points'].map(
    (c) => ['match_quarter', "match_id || ' ' || team_id || ' Q' || quarter", c] as const,
  ),
];

export function generatedTests(stats: readonly StatColumnDef[]): GeneratedTest[] {
  const noNegatives = [
    ...stats.flatMap(({ column }) => [
      `SELECT 'player_match' AS source, match_id || ' ' || player_id AS row_key, '${column}' AS column_name, ${column}::DOUBLE AS value FROM player_match WHERE ${column} < 0`,
      `SELECT 'team_match_totals', match_id || ' ' || team_id, '${column}', ${column}::DOUBLE FROM team_match_totals WHERE ${column} < 0`,
    ]),
    ...OTHER_COUNTS.map(
      ([table, key, column]) =>
        `SELECT '${table}', ${key}, '${column}', ${column}::DOUBLE FROM ${table} WHERE ${column} < 0`,
    ),
  ];

  // BR is owned by test 080 (Brownlow votes stay NULL until the count, decision D-b).
  const coverage = stats
    .filter(({ column }) => column !== 'br')
    .map(
      ({ column }) =>
        `SELECT pm.match_id, pm.player_id, '${column}' AS column_name, m.season, d.first_season, pm.${column}::DOUBLE AS value
FROM player_match pm JOIN match m USING (match_id) JOIN stat_definition d ON d.column_name = '${column}'
WHERE (m.season >= d.first_season) = (pm.${column} IS NULL)`,
    );

  // %P has no team total (blank on the page). The Totals row's BH includes rushed behinds (M1c).
  const totals = stats
    .filter(({ column }) => column !== 'pct_played')
    .map(({ column }) => {
      const players = column === 'bh' ? 'v.bh + t.rushed_behinds' : `v.${column}`;
      return `SELECT t.match_id, t.team_id, '${column}' AS column_name, (${players})::DOUBLE AS sum_of_players, t.${column}::DOUBLE AS totals_row
FROM team_match_totals t LEFT JOIN team_match v USING (match_id, team_id)
WHERE ${players} IS DISTINCT FROM t.${column}`;
    });

  return [
    {
      name: 'G1_no_negatives',
      description: 'No negative stat, score or count (generated per stat_definition row)',
      sql: noNegatives.join('\nUNION ALL\n'),
    },
    {
      name: 'G2_coverage_no_null',
      description:
        "Inside a stat's coverage there is no NULL, and before it no value (§6.4.1; BR is test 080)",
      sql: coverage.join('\nUNION ALL\n'),
    },
    {
      name: 'G3_totals_equal_players',
      description: 'Each team Totals row = Σ its players, per stat (generated team_match view)',
      sql: totals.join('\nUNION ALL\n'),
    },
  ];
}
