/**
 * zod schemas for Squiggle API responses (proposal §6.1, task 9.6), validated against the fields
 * seen in the M1a fixtures, which differ from §6.1 in places:
 * - `date` is Melbourne time (in the game's `tz`), while `localtime` is the venue's local time.
 * - `is_final` is a number (0 home-and-away, 2 elimination, 3 qualifying, 4 semi, 5 preliminary,
 *   6 Grand Final) and `is_grand_final` is 0 or 1.
 * - `winner` and `winnerteamid` are null for a draw.
 *
 * These are source schemas, so they're non-strict: unknown upstream fields are dropped, not
 * rejected. Assumptions, since the fixtures hold completed games only: scores may be null until a
 * game has started, and teams may be null for a final whose teams aren't decided yet (Squiggle
 * lists later finals before the earlier weeks are played). A started game needs both teams, and a
 * complete one needs its scores.
 */
import { z } from 'zod';
import { Season } from './schemas.ts';

const id = z.int().positive();
const count = z.int().nonnegative();
const nullableCount = count.nullable();
/** `YYYY-MM-DD HH:MM:SS` */
const dateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

export const SquiggleTeam = z.object({
  id,
  name: z.string().min(1),
  abbrev: z.string().min(1),
  debut: z.int(),
  retirement: z.int(),
});
export type SquiggleTeam = z.infer<typeof SquiggleTeam>;

export const SquiggleGame = z
  .object({
    id,
    year: Season,
    round: count,
    roundname: z.string().min(1),
    is_final: z.int().min(0).max(6),
    is_grand_final: z.union([z.literal(0), z.literal(1)]),
    /** NULL while a final's teams are undecided. */
    hteamid: id.nullable(),
    ateamid: id.nullable(),
    hteam: z.string().min(1).nullable(),
    ateam: z.string().min(1).nullable(),
    hgoals: nullableCount,
    hbehinds: nullableCount,
    hscore: nullableCount,
    agoals: nullableCount,
    abehinds: nullableCount,
    ascore: nullableCount,
    winner: z.string().nullable(),
    winnerteamid: id.nullable(),
    venue: z.string().min(1),
    /** Melbourne time, in `tz`. */
    date: dateTime,
    /** Venue-local time: its date part is the join key (§6.4.5). */
    localtime: dateTime,
    tz: z.string().regex(/^[+-]\d{2}:\d{2}$/),
    unixtime: id,
    /** 0–100; 100 is final. */
    complete: z.int().min(0).max(100),
  })
  .refine(
    (g) => g.complete === 0 || (g.hteamid !== null && g.ateamid !== null),
    'started game without teams',
  )
  .refine(
    (g) =>
      g.complete < 100 ||
      [g.hgoals, g.hbehinds, g.hscore, g.agoals, g.abehinds, g.ascore].every((v) => v !== null),
    'complete game without scores',
  );
export type SquiggleGame = z.infer<typeof SquiggleGame>;

export const SquiggleStanding = z.object({
  id,
  name: z.string().min(1),
  rank: id,
  played: count,
  wins: count,
  losses: count,
  draws: count,
  pts: count,
  for: count,
  against: count,
  /** Unrounded for ÷ against × 100. */
  percentage: z.number().nonnegative(),
  goals_for: count,
  behinds_for: count,
  goals_against: count,
  behinds_against: count,
});
export type SquiggleStanding = z.infer<typeof SquiggleStanding>;

/** `?q=teams`, `?q=games;year=Y` and `?q=standings;year=Y` response envelopes. */
export const SquiggleTeamsResponse = z.object({ teams: z.array(SquiggleTeam) });
export const SquiggleGamesResponse = z.object({ games: z.array(SquiggleGame) });
export const SquiggleStandingsResponse = z.object({ standings: z.array(SquiggleStanding) });
