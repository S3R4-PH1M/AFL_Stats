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
  MAX_CONSECUTIVE_FAILURES,
  NotFoundError,
  OfflineCacheMissError,
  RunAbortedError,
} from './http.ts';
import { fetchGames, fetchStandings, fetchTeams } from './squiggle/client.ts';
import { assertTeamsMapped, isComplete, SquiggleIndex } from './squiggle/map.ts';

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
  /** Squiggle games not yet complete (including finals whose teams are undecided). */
  squiggleNotComplete: number;
  seasonPageLinks: number;
  /** Requested from the network this run. */
  fetched: string[];
  /** Already in the raw cache (or served from it offline). */
  cached: string[];
  /** Season-page matches whose Squiggle game isn't complete: never fetched. */
  notComplete: string[];
  /** Match keys that 404'd, or `{date} {home} v {away}` for complete games with no season-page link. */
  notYetPublished: string[];
  /** Matches still to fetch when the run aborted. */
  notAttempted: string[];
  failed: { matchKey: string; reason: string }[];
  /** E.g. a refresh that failed, so a stale cached copy was used. */
  warnings: string[];
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

/** Records a failed refresh: `http.ts` then serves the stale cached copy instead of failing. */
function warnOnStaleRefresh(http: HttpClient, warnings: string[]): HttpClient {
  return {
    async get(url, options) {
      const result = await http.get(url, options);
      if (result.refreshError) {
        warnings.push(
          `refresh failed, using the copy cached at ${result.fetchedAt}: ${result.refreshError.message}`,
        );
      }
      return result;
    },
  };
}

const matchKeyOf = (url: string) => /(\d{12})\.html$/.exec(url)?.[1] ?? url;

export async function runIngest(opts: IngestOptions, deps: IngestDeps): Promise<IngestSummary> {
  const { season, force = false } = opts;
  const { cache } = deps;
  const warnings: string[] = [];
  const http = warnOnStaleRefresh(deps.http, warnings);
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
    squiggleNotComplete: games.filter((g) => !isComplete(g)).length,
    seasonPageLinks: links.length,
    fetched: [],
    cached: [],
    notComplete: [],
    notYetPublished: [],
    notAttempted: [],
    failed: [],
    warnings,
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
    if (!isComplete(game)) summary.notComplete.push(link.matchKey);
    else if (!force && (await cache.has(cacheKeyForUrl(link.url)))) {
      summary.cached.push(link.matchKey);
    } else toFetch.push(link.url);
  }
  for (const game of games) {
    const key = index.keyFor(game);
    if (key && isComplete(game) && !linked.has(game.id)) {
      summary.notYetPublished.push(`${key.date} ${key.homeTeamId} v ${key.awayTeamId}`);
    }
  }

  for (const [i, url] of toFetch.entries()) {
    const matchKey = matchKeyOf(url);
    try {
      const result = await http.get(url, { force });
      // Offline (even with --force) the page comes from the cache: never report it as fetched.
      (result.fromCache ? summary.cached : summary.fetched).push(matchKey);
    } catch (error) {
      if (error instanceof RunAbortedError) {
        summary.aborted = true;
        summary.notAttempted = toFetch.slice(i).map(matchKeyOf);
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
    `ingest ${s.season}: ${s.squiggleComplete} complete in Squiggle (${s.squiggleNotComplete} not complete), ` +
      `${s.seasonPageLinks} on the AFL Tables season page`,
    line('fetched', s.fetched),
    line('cached', s.cached),
    line('not complete', s.notComplete),
    line('not yet published', s.notYetPublished),
    ...(s.aborted ? [line('not attempted', s.notAttempted)] : []),
    line(
      'failed',
      s.failed.map((f) => `${f.matchKey}: ${f.reason}`),
    ),
    ...s.warnings.map((w) => `warning: ${w}`),
    ...(s.aborted
      ? [`aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failed requests; re-run to resume`]
      : []),
  ].join('\n');
}
