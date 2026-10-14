/**
 * One season's ingest run (proposal §8.1 steps 1–5, task 9.7). It only fills the raw cache:
 * match pages are never parsed here, only in `db:build`. The season page is parsed, because it is
 * the list of match keys.
 *
 * 1. Squiggle teams (all must map), games and standings.
 * 2. The AFL Tables season page.
 * 3. Join its links to Squiggle games on (local date, home, away); compare against the cache.
 * 4. Fetch the uncached matches Squiggle marks complete, one at a time through `http.ts`.
 * 5. Summarise: fetched / cached / not yet published / failed.
 *
 * Re-running is safe: cache writes are atomic, and cached match pages are skipped unless `force`.
 */
import { decodeHtml } from './afltables/decode.ts';
import { parseSeasonPage } from './afltables/seasonPage.ts';
import { cacheKeyForUrl, type RawCache } from './cache.ts';
import {
  type GetOptions,
  type HttpClient,
  NotFoundError,
  OfflineCacheMissError,
  RunAbortedError,
} from './http.ts';
import { fetchGames, fetchStandings, fetchTeams } from './squiggle/client.ts';
import {
  assertTeamsMapped,
  gameLocalDate,
  isComplete,
  SquiggleIndex,
  squiggleTeamId,
} from './squiggle/map.ts';

export interface IngestOptions {
  season: number;
  /** Re-fetch pages that are already cached (still at most once per run). */
  force?: boolean | undefined;
}

export interface IngestDeps {
  http: HttpClient;
  cache: RawCache;
  now: () => number;
}

export interface IngestSummary {
  season: number;
  /** Squiggle games with `complete === 100`. */
  squiggleComplete: number;
  notComplete: number;
  seasonPageLinks: number;
  fetched: string[];
  cached: string[];
  /** Match keys that 404'd, or `{date} {home} v {away}` for complete games with no season-page link. */
  notYetPublished: string[];
  failed: { matchKey: string; reason: string }[];
  aborted: boolean;
}

export const seasonPageUrl = (season: number) => `https://afltables.com/afl/seas/${season}.html`;

/**
 * Squiggle data and the season page change until the season ends. Re-fetch them (once per run)
 * unless the cached copy was fetched after 1 January of the following year.
 */
export function seasonRefresh(season: number, now: number, force = false): GetOptions {
  if (force) return { force: true };
  return { maxAgeMs: Math.max(0, now - Date.UTC(season + 1, 0, 1)) };
}

export async function runIngest(opts: IngestOptions, deps: IngestDeps): Promise<IngestSummary> {
  const { season, force = false } = opts;
  const { http, cache } = deps;
  const refresh = seasonRefresh(season, deps.now(), force);

  assertTeamsMapped(await fetchTeams(http, refresh));
  const games = await fetchGames(http, season, refresh);
  await fetchStandings(http, season, refresh); // cached for db:build's ladder test
  const page = await http.get(seasonPageUrl(season), refresh);
  const links = parseSeasonPage(decodeHtml(page.body), season);
  const index = new SquiggleIndex(games);

  const summary: IngestSummary = {
    season,
    squiggleComplete: games.filter(isComplete).length,
    notComplete: games.filter((g) => !isComplete(g)).length,
    seasonPageLinks: links.length,
    fetched: [],
    cached: [],
    notYetPublished: [],
    failed: [],
    aborted: false,
  };

  const linked = new Set<number>();
  const toFetch: string[] = [];
  for (const link of links) {
    const game = index.find(link);
    if (!game) {
      summary.failed.push({ matchKey: link.matchKey, reason: 'no Squiggle game' });
      continue;
    }
    linked.add(game.id);
    if (!isComplete(game)) continue;
    if (!force && (await cache.get(cacheKeyForUrl(link.url)))) summary.cached.push(link.matchKey);
    else toFetch.push(link.url);
  }
  for (const game of games) {
    if (isComplete(game) && !linked.has(game.id)) {
      const context = `games ${season}`;
      const home = squiggleTeamId(game.hteamid, game.hteam, context);
      const away = squiggleTeamId(game.ateamid, game.ateam, context);
      summary.notYetPublished.push(`${gameLocalDate(game)} ${home} v ${away}`);
    }
  }

  for (const url of toFetch) {
    const matchKey = /(\d{12})\.html$/.exec(url)?.[1] ?? url;
    try {
      await http.get(url, { force });
      summary.fetched.push(matchKey);
    } catch (error) {
      if (error instanceof RunAbortedError) {
        summary.aborted = true;
        break;
      }
      if (error instanceof NotFoundError) summary.notYetPublished.push(matchKey);
      else if (error instanceof OfflineCacheMissError) {
        summary.failed.push({ matchKey, reason: 'not cached (offline)' });
      } else summary.failed.push({ matchKey, reason: (error as Error).message });
    }
  }
  return summary;
}

const LIST_LIMIT = 10;

export function formatSummary(s: IngestSummary): string {
  const line = (label: string, items: string[]) => {
    const shown = items.slice(0, LIST_LIMIT).join(', ');
    const more = items.length > LIST_LIMIT ? ` … and ${items.length - LIST_LIMIT} more` : '';
    const list = items.length > 0 ? `   ${shown}${more}` : '';
    return `  ${label.padEnd(17)} ${String(items.length).padStart(4)}${list}`;
  };
  return [
    `ingest ${s.season}: ${s.squiggleComplete} complete in Squiggle (${s.notComplete} not complete), ` +
      `${s.seasonPageLinks} on the AFL Tables season page`,
    line('fetched', s.fetched),
    line('cached', s.cached),
    line('not yet published', s.notYetPublished),
    line(
      'failed',
      s.failed.map((f) => `${f.matchKey}: ${f.reason}`),
    ),
    ...(s.aborted ? ['aborted after 5 consecutive failed requests; re-run to resume'] : []),
  ].join('\n');
}
