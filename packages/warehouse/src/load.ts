/**
 * Parsed rows → warehouse rows (task 9.8). Pure except for `LoadBatch.insert`.
 *
 * | Parsed (`parseMatchPage`)                         | Table               |
 * |---------------------------------------------------|---------------------|
 * | `match` + Squiggle join + `source_fetched_at`     | `match`             |
 * | `quarters`                                        | `match_quarter`     |
 * | `players`                                         | `player_match`      |
 * | `people`, de-duplicated across matches            | `player`            |
 * | `teamTotals` (Totals row + rushed behinds)        | `team_match_totals` |
 *
 * Brownlow votes (decision D-b): AFL Tables leaves BR blank until the count, and a blank reads
 * as 0. A home-and-away match whose BR column sums to 0 is therefore loaded with BR NULL, with
 * a warning to re-fetch after the count. Data test 080 checks the rest.
 */
import {
  type PlayerMatchRow,
  type PlayerRow,
  type SquiggleGame,
  type SquiggleStanding,
  STAT_COLUMNS,
  STAT_DEFINITIONS,
  TEAMS,
} from '@afl/core';
import {
  applySquiggle,
  gameJoinKey,
  type ParsedMatchPage,
  parsePageDateTime,
  squiggleTeamId,
  type TeamTotals,
  unixtimeIso,
} from '@afl/ingest';
import { listValue } from '@duckdb/node-api';
import { type DuckDBConnection, type DuckDBValue, insertRows } from './db.ts';

export const COLUMNS = {
  team: ['team_id', 'name', 'abbrev', 'squiggle_id', 'afltables_names', 'lineage_of'],
  stat_definition: [
    'code',
    'column_name',
    'label',
    'description',
    'first_season',
    'higher_is_better',
    'display_order',
  ],
  player: ['player_id', 'first_name', 'surname', 'display_name'],
  match: [
    'match_id',
    'squiggle_id',
    'season',
    'round_label',
    'round_no',
    'is_final',
    'is_grand_final',
    'start_utc',
    'local_date',
    'local_time',
    'venue',
    'attendance',
    'home_team_id',
    'away_team_id',
    'home_score',
    'away_score',
    'source_fetched_at',
  ],
  match_quarter: [
    'match_id',
    'team_id',
    'quarter',
    'goals',
    'behinds',
    'points',
    'cum_goals',
    'cum_behinds',
    'cum_points',
  ],
  player_match: ['match_id', 'player_id', 'team_id', 'jumper', 'sub_status', ...STAT_COLUMNS],
  team_match_totals: ['match_id', 'team_id', 'rushed_behinds', ...STAT_COLUMNS],
  squiggle_game: [
    'squiggle_id',
    'season',
    'round_no',
    'round_label',
    'is_final',
    'is_grand_final',
    'home_team_id',
    'away_team_id',
    'home_goals',
    'home_behinds',
    'home_score',
    'away_goals',
    'away_behinds',
    'away_score',
    'venue',
    'local_date',
    'start_utc',
    'complete',
  ],
  squiggle_standing: [
    'season',
    'team_id',
    'rank',
    'played',
    'wins',
    'losses',
    'draws',
    'pts',
    'points_for',
    'points_against',
    'percentage',
  ],
} as const;

export type TableName = keyof typeof COLUMNS;

/** Insertion order, parents before children (foreign keys). */
const TABLE_ORDER: readonly TableName[] = [
  'team',
  'stat_definition',
  'player',
  'match',
  'match_quarter',
  'player_match',
  'team_match_totals',
  'squiggle_game',
  'squiggle_standing',
];

const BR_FIRST_SEASON = STAT_DEFINITIONS.find((d) => d.column === 'br')?.firstSeason ?? 0;

/**
 * Decision D-b: a home-and-away match inside BR's coverage whose votes sum to 0 hasn't had its
 * votes published, so BR is NULL for its players and team totals, not 0.
 */
export function applyBrownlowRule(page: ParsedMatchPage): {
  players: PlayerMatchRow[];
  teamTotals: TeamTotals[];
  warning?: string;
} {
  const { match, players, teamTotals } = page;
  const votes = players.reduce((sum, p) => sum + (p.br ?? 0), 0);
  if (match.is_final || match.season < BR_FIRST_SEASON || votes > 0) {
    return { players, teamTotals };
  }
  return {
    players: players.map((p) => ({ ...p, br: null })),
    teamTotals: teamTotals.map((t) => ({ ...t, stats: { ...t.stats, br: null } })),
    warning:
      `${match.match_id}: Brownlow votes not yet published (BR loaded as NULL); after the count ` +
      `run npm run ingest -- --season ${match.season} --force`,
  };
}

type Rows = { [T in TableName]: DuckDBValue[][] };

/** Rows for one build, accumulated in memory and inserted in foreign-key order. */
export class LoadBatch {
  readonly rows: Rows = {
    team: [],
    stat_definition: [],
    player: [],
    match: [],
    match_quarter: [],
    player_match: [],
    team_match_totals: [],
    squiggle_game: [],
    squiggle_standing: [],
  };
  readonly warnings: string[] = [];
  private readonly people = new Map<string, PlayerRow & { firstMatch: string }>();

  /** `team` and `stat_definition` from core. */
  seed(): void {
    for (const t of TEAMS) {
      this.rows.team.push([
        t.teamId,
        t.name,
        t.abbrev,
        t.squiggleId,
        listValue([...t.afltablesNames]),
        t.lineageOf,
      ]);
    }
    for (const d of STAT_DEFINITIONS) {
      this.rows.stat_definition.push([
        d.code,
        d.column,
        d.label,
        d.description,
        d.firstSeason,
        d.higherIsBetter,
        d.displayOrder,
      ]);
    }
  }

  /** One parsed match page, its joined Squiggle game (if any) and the page's fetch time. */
  addMatch(page: ParsedMatchPage, game: SquiggleGame | undefined, fetchedAt: string): void {
    const joined = applySquiggle(page.match, game);
    this.warnings.push(...page.warnings.map((w) => `${page.match.match_id}: ${w}`));
    this.warnings.push(...joined.warnings);
    const brownlow = applyBrownlowRule(page);
    if (brownlow.warning) this.warnings.push(brownlow.warning);

    const m = joined.row;
    this.rows.match.push([
      m.match_id,
      m.squiggle_id,
      m.season,
      m.round_label,
      m.round_no,
      m.is_final,
      m.is_grand_final,
      m.start_utc,
      parsePageDateTime(m.local_time).date,
      m.local_time,
      m.venue,
      m.attendance,
      m.home_team_id,
      m.away_team_id,
      m.home_score,
      m.away_score,
      fetchedAt,
    ]);
    for (const q of page.quarters) {
      this.rows.match_quarter.push([
        q.match_id,
        q.team_id,
        q.quarter,
        q.goals,
        q.behinds,
        q.points,
        q.cum_goals,
        q.cum_behinds,
        q.cum_points,
      ]);
    }
    for (const p of brownlow.players) {
      this.rows.player_match.push([
        p.match_id,
        p.player_id,
        p.team_id,
        p.jumper,
        p.sub_status,
        ...STAT_COLUMNS.map((c) => p[c]),
      ]);
    }
    for (const t of brownlow.teamTotals) {
      this.rows.team_match_totals.push([
        m.match_id,
        t.team_id,
        t.rushed_behinds,
        ...STAT_COLUMNS.map((c) => t.stats[c]),
      ]);
    }
    for (const person of page.people) this.addPerson(person, m.match_id);
  }

  /**
   * A season's Squiggle games and standings. A final whose teams are undecided isn't loaded: it
   * can't be joined, and it isn't a home-and-away game, so `season_load` doesn't need it.
   */
  addSquiggle(
    season: number,
    games: readonly SquiggleGame[],
    standings: readonly SquiggleStanding[],
  ): void {
    for (const g of games) {
      const key = gameJoinKey(g);
      if (!key) continue;
      this.rows.squiggle_game.push([
        g.id,
        g.year,
        g.round,
        g.roundname,
        g.is_final > 0,
        g.is_grand_final === 1,
        key.homeTeamId,
        key.awayTeamId,
        g.hgoals,
        g.hbehinds,
        g.hscore,
        g.agoals,
        g.abehinds,
        g.ascore,
        g.venue,
        key.date,
        unixtimeIso(g),
        g.complete,
      ]);
    }
    for (const s of standings) {
      this.rows.squiggle_standing.push([
        season,
        squiggleTeamId(s.id, s.name, `standings ${season}`),
        s.rank,
        s.played,
        s.wins,
        s.losses,
        s.draws,
        s.pts,
        s.for,
        s.against,
        s.percentage,
      ]);
    }
  }

  /** De-duplicated players; a later match naming a player differently keeps the first name. */
  private addPerson(person: PlayerRow, matchId: string): void {
    const seen = this.people.get(person.player_id);
    if (!seen) {
      this.people.set(person.player_id, { ...person, firstMatch: matchId });
      this.rows.player.push([
        person.player_id,
        person.first_name,
        person.surname,
        person.display_name,
      ]);
    } else if (seen.display_name !== person.display_name) {
      this.warnings.push(
        `${matchId}: ${person.player_id} is "${person.display_name}", but "${seen.display_name}" ` +
          `in ${seen.firstMatch}; keeping the first`,
      );
    }
  }

  async insert(conn: DuckDBConnection): Promise<void> {
    for (const table of TABLE_ORDER) {
      await insertRows(conn, table, COLUMNS[table], this.rows[table]);
    }
  }
}
