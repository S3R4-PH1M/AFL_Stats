/**
 * Warehouse → published `v1` objects (proposal §10, task 9.9). One query per table per season,
 * assembled in TypeScript; the result is validated against the core schemas when it's written.
 *
 * | File                         | Tables                                                    |
 * |------------------------------|-----------------------------------------------------------|
 * | `meta.json`                  | `match` (seasons, latest fetch), `team`, `stat_definition` |
 * | `seasons/{y}/ladder.json`    | `ladder_round`, round labels from `match`                 |
 * | `seasons/{y}/matches.json`   | `match`, `match_quarter`                                  |
 * | `matches/{y}/{matchId}.json` | the above, `player_match` ⨝ `player`, `team_match_totals` |
 *
 * Every ordering is total, so a rebuild with no data change writes identical files.
 */
import {
  type BoxScoreLine,
  DATA_CONTRACT_VERSION,
  type LadderRow,
  type MatchDetailFile,
  type MatchSide,
  type MatchSummary,
  type MetaFile,
  type QuarterScore,
  type SeasonLadderFile,
  type SeasonMatchesFile,
  STAT_COLUMNS,
  type StatValues,
} from '@afl/core';
import { type DuckDBConnection, queryRows, type Row } from '@afl/warehouse';

const STAT_SELECT = STAT_COLUMNS.join(', ');

/** DuckDB → JS: TIMESTAMPTZ arrives as a `Date` or null. Anything else is a driver change: fail. */
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  throw new Error(`publish: expected a TIMESTAMPTZ as a Date, got ${typeof value}`);
}

function statValues(row: Row): StatValues {
  return Object.fromEntries(STAT_COLUMNS.map((c) => [c, row[c] ?? null])) as StatValues;
}

/** Groups rows by a key, keeping row order inside each group. */
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

export async function querySeasons(conn: DuckDBConnection): Promise<number[]> {
  const rows = await queryRows(conn, 'SELECT DISTINCT season FROM match ORDER BY season');
  return rows.map((r) => r.season as number);
}

export async function queryMeta(conn: DuckDBConnection): Promise<MetaFile> {
  const [latest] = await queryRows(conn, 'SELECT max(source_fetched_at) AS at FROM match');
  const teams = await queryRows(
    conn,
    'SELECT team_id, name, abbrev FROM team ORDER BY name, team_id',
  );
  const stats = await queryRows(
    conn,
    `SELECT code, column_name, label, description, first_season, higher_is_better, display_order
     FROM stat_definition ORDER BY display_order, code`,
  );
  const dataAsOf = iso(latest?.at);
  if (!dataAsOf) throw new Error('publish: the warehouse has no matches; run npm run db:build');
  return {
    version: DATA_CONTRACT_VERSION,
    dataAsOf,
    seasons: await querySeasons(conn),
    teams: teams.map((t) => ({
      teamId: t.team_id as string,
      name: t.name as string,
      abbrev: t.abbrev as string,
    })),
    stats: stats.map((s) => ({
      code: s.code as string,
      column: s.column_name as MetaFile['stats'][number]['column'],
      label: s.label as string,
      description: s.description as string,
      firstSeason: s.first_season as number,
      higherIsBetter: s.higher_is_better as boolean,
      displayOrder: s.display_order as number,
    })),
  };
}

export async function querySeasonLadder(
  conn: DuckDBConnection,
  season: number,
): Promise<SeasonLadderFile> {
  const labelRows = await queryRows(
    conn,
    `SELECT round_no, list(DISTINCT round_label ORDER BY round_label) AS labels
     FROM match WHERE season = $1 AND NOT is_final GROUP BY round_no`,
    [season],
  );
  const labels = new Map<number, string>();
  for (const r of labelRows) {
    const list = r.labels as string[];
    if (list.length !== 1) {
      throw new Error(`${season} round ${r.round_no} has more than one label: ${list.join(', ')}`);
    }
    labels.set(r.round_no as number, list[0] as string);
  }

  const rows = await queryRows(
    conn,
    `SELECT round_no, rank, team_id, played, wins, losses, draws, pts, points_for,
       points_against, percentage
     FROM ladder_round WHERE season = $1 ORDER BY round_no, rank`,
    [season],
  );
  const rounds = [...groupBy(rows, (r) => String(r.round_no)).values()].map((group) => {
    const roundNo = group[0]?.round_no as number;
    const roundLabel = labels.get(roundNo);
    if (!roundLabel) throw new Error(`${season} round ${roundNo} has a ladder but no match`);
    return {
      roundNo,
      roundLabel,
      rows: group.map(
        (r): LadderRow => ({
          rank: r.rank as number,
          teamId: r.team_id as string,
          played: r.played as number,
          wins: r.wins as number,
          losses: r.losses as number,
          draws: r.draws as number,
          pts: r.pts as number,
          pointsFor: r.points_for as number,
          pointsAgainst: r.points_against as number,
          percentage: (r.percentage as number | null) ?? null,
        }),
      ),
    };
  });
  return { season, rounds };
}

const MATCH_ORDER = 'round_no NULLS LAST, start_utc NULLS LAST, local_date, match_id';

async function querySummaries(conn: DuckDBConnection, season: number): Promise<MatchSummary[]> {
  const matches = await queryRows(
    conn,
    `SELECT * FROM match WHERE season = $1 ORDER BY ${MATCH_ORDER}`,
    [season],
  );
  const quarters = await queryRows(
    conn,
    `SELECT q.* FROM match_quarter q JOIN match m USING (match_id)
     WHERE m.season = $1 ORDER BY q.match_id, q.team_id, q.quarter`,
    [season],
  );
  const byMatchTeam = groupBy(quarters, (q) => `${q.match_id} ${q.team_id}`);

  const side = (matchId: string, teamId: string, score: number): MatchSide => {
    const rows = byMatchTeam.get(`${matchId} ${teamId}`) ?? [];
    const last = rows.at(-1);
    if (!last) throw new Error(`${matchId}: no quarter scores for ${teamId}`);
    return {
      teamId,
      goals: last.cum_goals as number,
      behinds: last.cum_behinds as number,
      score,
      quarters: rows.map(
        (q): QuarterScore => ({
          quarter: q.quarter as number,
          goals: q.goals as number,
          behinds: q.behinds as number,
          points: q.points as number,
          cumGoals: q.cum_goals as number,
          cumBehinds: q.cum_behinds as number,
          cumPoints: q.cum_points as number,
        }),
      ),
    };
  };

  return matches.map((m) => {
    const matchId = m.match_id as string;
    return {
      matchId,
      squiggleId: (m.squiggle_id as number | null) ?? null,
      season: m.season as number,
      roundNo: (m.round_no as number | null) ?? null,
      roundLabel: m.round_label as string,
      isFinal: m.is_final as boolean,
      isGrandFinal: m.is_grand_final as boolean,
      startUtc: iso(m.start_utc),
      localTime: m.local_time as string,
      venue: m.venue as string,
      attendance: (m.attendance as number | null) ?? null,
      home: side(matchId, m.home_team_id as string, m.home_score as number),
      away: side(matchId, m.away_team_id as string, m.away_score as number),
    };
  });
}

export async function querySeasonMatches(
  conn: DuckDBConnection,
  season: number,
): Promise<SeasonMatchesFile> {
  return { season, matches: await querySummaries(conn, season) };
}

/** Pass `summaries` from `querySeasonMatches` to avoid querying the matches twice. */
export async function queryMatchDetails(
  conn: DuckDBConnection,
  season: number,
  summaries?: readonly MatchSummary[],
): Promise<MatchDetailFile[]> {
  summaries ??= await querySummaries(conn, season);
  const players = await queryRows(
    conn,
    `SELECT pm.match_id, pm.team_id, pm.player_id, p.display_name, pm.jumper, pm.sub_status,
       ${STAT_COLUMNS.map((c) => `pm.${c}`).join(', ')}
     FROM player_match pm
     JOIN player p USING (player_id)
     JOIN match m USING (match_id)
     WHERE m.season = $1
     ORDER BY pm.match_id, pm.team_id, pm.jumper NULLS LAST, pm.player_id`,
    [season],
  );
  const totals = await queryRows(
    conn,
    `SELECT t.match_id, t.team_id, t.rushed_behinds, ${STAT_SELECT}
     FROM team_match_totals t JOIN match m USING (match_id) WHERE m.season = $1`,
    [season],
  );
  const playersBy = groupBy(players, (p) => `${p.match_id} ${p.team_id}`);
  const totalsBy = new Map(totals.map((t) => [`${t.match_id} ${t.team_id}`, t]));

  return summaries.map((summary) => {
    const detail = (side: MatchSide) => {
      const key = `${summary.matchId} ${side.teamId}`;
      const total = totalsBy.get(key);
      if (!total) throw new Error(`${summary.matchId}: no Totals row for ${side.teamId}`);
      return {
        ...side,
        players: (playersBy.get(key) ?? []).map(
          (p): BoxScoreLine => ({
            playerId: p.player_id as string,
            displayName: p.display_name as string,
            jumper: (p.jumper as number | null) ?? null,
            subStatus: (p.sub_status as BoxScoreLine['subStatus']) ?? null,
            stats: statValues(p),
          }),
        ),
        totals: statValues(total),
        rushedBehinds: total.rushed_behinds as number,
      };
    };
    return { ...summary, home: detail(summary.home), away: detail(summary.away) };
  });
}
