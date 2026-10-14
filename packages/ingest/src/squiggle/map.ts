/**
 * Squiggle ↔ AFL Tables mapping (proposal §6.4.5–6.4.6, task 9.6).
 *
 * - Squiggle team IDs map to `team_id` through `core/teams.ts`.
 * - Games join to AFL Tables matches on **(venue-local date, home, away)**, never on time. The
 *   date is the date part of Squiggle `localtime` (venue-local), not `date` (Melbourne time),
 *   which would put a late Perth game on the next day.
 * - A joined match takes Squiggle's `id`, its `unixtime` as `start_utc` (the page time is the
 *   fallback), and Squiggle's home-and-away round numbering: "Opening Round" is round 0, while
 *   AFL Tables numbers it Round 1 (decision D-a, M1d). Finals keep the AFL Tables label.
 * - Only `complete === 100` games count as final.
 */
import {
  type SquiggleGame,
  type SquiggleTeam,
  teamBySquiggleId,
  UnknownTeamError,
} from '@afl/core';
import type { ParsedMatchRow } from '../afltables/matchPage.ts';

export const isComplete = (game: SquiggleGame): boolean => game.complete === 100;

/** Venue-local date of a game, `YYYY-MM-DD`. */
export const gameLocalDate = (game: SquiggleGame): string => game.localtime.slice(0, 10);

/** Maps a Squiggle team ID, naming the team and the context (e.g. "games 2025") if it can't. */
export function squiggleTeamId(id: number, name: string, context: string): string {
  try {
    return teamBySquiggleId(id).teamId;
  } catch (error) {
    if (!(error instanceof UnknownTeamError)) throw error;
    throw new UnknownTeamError(`Unmapped Squiggle team ${id} "${name}" (${context})`);
  }
}

export function assertTeamsMapped(teams: readonly SquiggleTeam[]): void {
  for (const t of teams) squiggleTeamId(t.id, t.name, 'teams');
}

export interface JoinKey {
  /** Venue-local date, `YYYY-MM-DD`. */
  date: string;
  homeTeamId: string;
  awayTeamId: string;
}

const keyOf = ({ date, homeTeamId, awayTeamId }: JoinKey) => `${date}|${homeTeamId}|${awayTeamId}`;

/** Squiggle games by join key. Two games with the same key are an error. */
export class SquiggleIndex {
  private readonly byKey = new Map<string, SquiggleGame>();

  constructor(games: readonly SquiggleGame[]) {
    for (const game of games) {
      const context = `games ${game.year}`;
      const key = keyOf({
        date: gameLocalDate(game),
        homeTeamId: squiggleTeamId(game.hteamid, game.hteam, context),
        awayTeamId: squiggleTeamId(game.ateamid, game.ateam, context),
      });
      const other = this.byKey.get(key);
      if (other) throw new Error(`2 Squiggle games (${other.id}, ${game.id}) share the key ${key}`);
      this.byKey.set(key, game);
    }
  }

  find(key: JoinKey): SquiggleGame | undefined {
    return this.byKey.get(keyOf(key));
  }
}

export const unixtimeIso = (game: SquiggleGame): string =>
  new Date(game.unixtime * 1000).toISOString();

/** A warning when the AFL Tables start differs from Squiggle's `unixtime` at all. */
export function startTimeWarning(
  matchId: string,
  pageUtc: string | null,
  game: SquiggleGame,
): string | undefined {
  const squiggleUtc = unixtimeIso(game);
  if (pageUtc === null || pageUtc === squiggleUtc) return undefined;
  const minutes = Math.round(Math.abs(Date.parse(pageUtc) - game.unixtime * 1000) / 60_000);
  return `${matchId}: AFL Tables start ${pageUtc} differs from Squiggle ${squiggleUtc} by ${minutes} min; using Squiggle`;
}

export interface Joined<T> {
  row: T;
  warnings: string[];
}

/** Applies a joined Squiggle game (or its absence) to a parsed match row. */
export function applySquiggle(
  match: ParsedMatchRow,
  game: SquiggleGame | undefined,
): Joined<ParsedMatchRow> {
  if (!game) {
    return {
      row: match,
      warnings: [
        `${match.match_id}: no Squiggle game; keeping the AFL Tables round and page start time`,
      ],
    };
  }
  const warnings: string[] = [];
  const timeWarning = startTimeWarning(match.match_id, match.start_utc, game);
  if (timeWarning) warnings.push(timeWarning);

  const row: ParsedMatchRow = { ...match, squiggle_id: game.id, start_utc: unixtimeIso(game) };
  const squiggleFinal = game.is_final > 0;
  if (squiggleFinal !== match.is_final) {
    warnings.push(
      `${match.match_id}: AFL Tables says ${match.is_final ? 'final' : 'home-and-away'}, ` +
        `Squiggle says ${squiggleFinal ? 'final' : 'home-and-away'}; keeping the AFL Tables round`,
    );
  } else if (!match.is_final) {
    row.round_no = game.round;
    row.round_label = game.roundname;
  }
  return { row, warnings };
}
