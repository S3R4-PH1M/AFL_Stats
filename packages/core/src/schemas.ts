/**
 * zod schemas for parsed rows and the published `v1` data contract (proposal §7, §10; task 9.1).
 *
 * - Parsed rows are snake_case and map 1:1 to the warehouse columns in §7.
 * - Published files are camelCase. Stat values are keyed by `StatDefinition.column`.
 *
 * Changing a published schema after M1e ships means bumping `data/v1` to `v2`.
 */
import { z } from 'zod';
import { STAT_COLUMNS, type StatColumn } from './stats.ts';

// ---------------------------------------------------------------------------
// Shared fields

export const Season = z.int().min(1897).max(2100);
/** AFL Tables match key: two ascending 2-digit team codes, then YYYYMMDD (§6.4.5). */
export const MatchId = z.string().regex(/^\d{12}$/);
/** Slug from `core/teams.ts`. */
export const TeamId = z.string().regex(/^[a-z]+(?:-[a-z]+)*$/);
/** AFL Tables player-page path, e.g. `T/Tom_Lynch1`, `A/Alex_Neal-Bullen` (§6.4.3). */
export const PlayerId = z
  .string()
  .regex(/^[A-Z]\/[^/\\]+$/)
  .refine((id) => !id.includes('..'), 'player_id must not contain ".."');
export const SubStatus = z.enum(['on', 'off']);

const count = z.int().nonnegative();
const pctPlayed = z.number().min(0).max(100);
const score = z.int().nonnegative();
const isoInstant = z.iso.datetime({ offset: true });

/** One nullable value per stat column. NULL means outside the stat's coverage (§6.4.1). */
const statShape = Object.fromEntries(
  STAT_COLUMNS.map((c) => [c, (c === 'pct_played' ? pctPlayed : count).nullable()]),
) as Record<StatColumn, z.ZodNullable<typeof count | typeof pctPlayed>>;

export const StatValues = z.strictObject(statShape);
export type StatValues = z.infer<typeof StatValues>;

// ---------------------------------------------------------------------------
// Parsed rows (ingest → warehouse)

export const MatchRow = z.strictObject({
  match_id: MatchId,
  squiggle_id: z.int().positive().nullable(),
  season: Season,
  round_label: z.string().min(1),
  /** NULL for finals, which have no home-and-away round number. */
  round_no: z.int().nonnegative().nullable(),
  is_final: z.boolean(),
  is_grand_final: z.boolean(),
  start_utc: isoInstant.nullable(),
  /** Venue local time string as shown on the page. */
  local_time: z.string().min(1),
  /** AFL Tables venue name; see `core/venues.ts`. */
  venue: z.string().min(1),
  attendance: z.int().nonnegative().nullable(),
  home_team_id: TeamId,
  away_team_id: TeamId,
  home_score: score,
  away_score: score,
  source_fetched_at: isoInstant,
});
export type MatchRow = z.infer<typeof MatchRow>;

export const QuarterRow = z.strictObject({
  match_id: MatchId,
  team_id: TeamId,
  /** 1–4; 5 and above is extra time. */
  quarter: z.int().min(1),
  goals: count,
  behinds: count,
  points: count,
  cum_goals: count,
  cum_behinds: count,
  cum_points: count,
});
export type QuarterRow = z.infer<typeof QuarterRow>;

export const PlayerMatchRow = z.strictObject({
  match_id: MatchId,
  player_id: PlayerId,
  team_id: TeamId,
  jumper: z.int().nonnegative().nullable(),
  sub_status: SubStatus.nullable(),
  ...statShape,
});
export type PlayerMatchRow = z.infer<typeof PlayerMatchRow>;

// ---------------------------------------------------------------------------
// Published files (apps/web/public/data/v1)

/** `meta.json` */
export const MetaFile = z.strictObject({
  version: z.literal('v1'),
  builtAt: isoInstant,
  seasons: z.array(Season),
  teams: z.array(
    z.strictObject({
      teamId: TeamId,
      name: z.string().min(1),
      abbrev: z.string().min(1),
    }),
  ),
  stats: z.array(
    z.strictObject({
      code: z.string().min(1),
      column: z.enum(STAT_COLUMNS),
      label: z.string().min(1),
      description: z.string(),
      firstSeason: Season,
      higherIsBetter: z.boolean(),
      displayOrder: z.int().positive(),
    }),
  ),
});
export type MetaFile = z.infer<typeof MetaFile>;

export const LadderRow = z.strictObject({
  rank: z.int().positive(),
  teamId: TeamId,
  played: count,
  wins: count,
  losses: count,
  draws: count,
  pts: count,
  pointsFor: count,
  pointsAgainst: count,
  percentage: z.number().nonnegative(),
});
export type LadderRow = z.infer<typeof LadderRow>;

/** `seasons/{year}/ladder.json`: the ladder after every home-and-away round. */
export const SeasonLadderFile = z.strictObject({
  season: Season,
  rounds: z.array(
    z.strictObject({
      roundNo: z.int().nonnegative(),
      rows: z.array(LadderRow),
    }),
  ),
});
export type SeasonLadderFile = z.infer<typeof SeasonLadderFile>;

export const QuarterScore = z.strictObject({
  quarter: z.int().min(1),
  goals: count,
  behinds: count,
  points: count,
  cumGoals: count,
  cumBehinds: count,
  cumPoints: count,
});
export type QuarterScore = z.infer<typeof QuarterScore>;

export const MatchSide = z.strictObject({
  teamId: TeamId,
  goals: count,
  behinds: count,
  score,
  quarters: z.array(QuarterScore),
});
export type MatchSide = z.infer<typeof MatchSide>;

const matchSummaryShape = {
  matchId: MatchId,
  squiggleId: z.int().positive().nullable(),
  season: Season,
  roundNo: z.int().nonnegative().nullable(),
  roundLabel: z.string().min(1),
  isFinal: z.boolean(),
  isGrandFinal: z.boolean(),
  startUtc: isoInstant.nullable(),
  localTime: z.string().min(1),
  venue: z.string().min(1),
  attendance: z.int().nonnegative().nullable(),
};

export const MatchSummary = z.strictObject({
  ...matchSummaryShape,
  home: MatchSide,
  away: MatchSide,
});
export type MatchSummary = z.infer<typeof MatchSummary>;

/** `seasons/{year}/matches.json`: fixture and results with quarter scores. */
export const SeasonMatchesFile = z.strictObject({
  season: Season,
  matches: z.array(MatchSummary),
});
export type SeasonMatchesFile = z.infer<typeof SeasonMatchesFile>;

export const BoxScoreLine = z.strictObject({
  playerId: PlayerId,
  displayName: z.string().min(1),
  jumper: z.int().nonnegative().nullable(),
  subStatus: SubStatus.nullable(),
  stats: StatValues,
});
export type BoxScoreLine = z.infer<typeof BoxScoreLine>;

export const MatchDetailSide = z.strictObject({
  ...MatchSide.shape,
  players: z.array(BoxScoreLine),
  totals: StatValues,
});
export type MatchDetailSide = z.infer<typeof MatchDetailSide>;

/** `matches/{year}/{matchId}.json`: full box score for one match. */
export const MatchDetailFile = z.strictObject({
  ...matchSummaryShape,
  home: MatchDetailSide,
  away: MatchDetailSide,
});
export type MatchDetailFile = z.infer<typeof MatchDetailFile>;
