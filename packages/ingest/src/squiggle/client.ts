/**
 * Squiggle API client (proposal §6.1, task 9.6). Every request goes through `http.ts`, so it is
 * throttled, cached and identified like any other. Responses are validated with the source schemas
 * in `core/squiggle.ts`.
 */
import {
  type SquiggleGame,
  SquiggleGamesResponse,
  type SquiggleStanding,
  SquiggleStandingsResponse,
  type SquiggleTeam,
  SquiggleTeamsResponse,
} from '@afl/core';
import type { GetOptions, HttpClient } from '../http.ts';

export const SQUIGGLE_API = 'https://api.squiggle.com.au/';

export type SquiggleQuery = 'teams' | 'games' | 'standings';

export function squiggleUrl(q: SquiggleQuery, year?: number): string {
  if ((q === 'teams') !== (year === undefined)) {
    throw new Error(`Squiggle ${q} ${q === 'teams' ? 'takes no' : 'needs a'} year`);
  }
  return `${SQUIGGLE_API}?q=${q}${year === undefined ? '' : `;year=${year}`}`;
}

export class SquiggleResponseError extends Error {
  constructor(url: string, message: string) {
    super(`Squiggle ${new URL(url).search.slice(1)}: ${message}`);
    this.name = 'SquiggleResponseError';
  }
}

export async function fetchTeams(http: HttpClient, opts?: GetOptions): Promise<SquiggleTeam[]> {
  return (await fetchJson(http, squiggleUrl('teams'), SquiggleTeamsResponse, opts)).teams;
}

export async function fetchGames(
  http: HttpClient,
  year: number,
  opts?: GetOptions,
): Promise<SquiggleGame[]> {
  const url = squiggleUrl('games', year);
  const { games } = await fetchJson(http, url, SquiggleGamesResponse, opts);
  const other = games.find((g) => g.year !== year);
  if (other) throw new SquiggleResponseError(url, `game ${other.id} is from year ${other.year}`);
  return games;
}

export async function fetchStandings(
  http: HttpClient,
  year: number,
  opts?: GetOptions,
): Promise<SquiggleStanding[]> {
  const url = squiggleUrl('standings', year);
  return (await fetchJson(http, url, SquiggleStandingsResponse, opts)).standings;
}

/** The zod schema surface used here, so ingest needs no direct zod import. */
interface Schema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
}

async function fetchJson<T>(
  http: HttpClient,
  url: string,
  schema: Schema<T>,
  opts: GetOptions | undefined,
): Promise<T> {
  const { body } = await http.get(url, opts);
  let json: unknown;
  try {
    json = JSON.parse(body.toString('utf8'));
  } catch {
    throw new SquiggleResponseError(url, 'response is not JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String).join('.') ?? '';
    throw new SquiggleResponseError(url, `${path}: ${issue?.message ?? 'invalid response'}`);
  }
  return parsed.data;
}
