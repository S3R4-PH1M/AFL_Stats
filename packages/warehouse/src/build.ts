/**
 * `npm run db:build [-- --raw <dir>] [--db <path>] [--season <YYYY> …]` (task 9.8).
 *
 * Recreates `data/afl.duckdb` from scratch, offline, from the raw cache only:
 * 1. apply `sql/schema.sql`
 * 2. seed `team` and `stat_definition` from core
 * 3. for each cached season: parse the season page, read Squiggle games and standings, then parse
 *    and load every cached match page (joined to Squiggle, `source_fetched_at` from the cache)
 * 4. create the generated `team_match` view and run `sql/models/*.sql` in filename order
 *
 * Seasons default to every season page in the cache. A match page that isn't cached is reported,
 * not an error; a page that fails to parse or reconcile stops the build.
 */
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { SquiggleGame, SquiggleStanding } from '@afl/core';
import {
  createHttpClient,
  decodeHtml,
  FsRawCache,
  fetchGames,
  fetchStandings,
  type ListableRawCache,
  OfflineCacheMissError,
  parseMatchPage,
  parseSeasonArg,
  parseSeasonPage,
  SquiggleIndex,
  seasonPageUrl,
} from '@afl/ingest';
import { closeDb, type DuckDBConnection, exec, openDb } from './db.ts';
import { LoadBatch } from './load.ts';
import { statColumns, teamMatchViewSql } from './sqlgen.ts';

export const SQL_DIR = new URL('../sql/', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface BuildOptions {
  conn: DuckDBConnection;
  cache: ListableRawCache;
  /** Defaults to every season page in the cache. */
  seasons?: readonly number[] | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface BuildReport {
  seasons: number[];
  matches: number;
  playerMatches: number;
  players: number;
  /** Season-page matches whose page isn't in the raw cache. */
  notCached: string[];
  warnings: string[];
}

export async function cachedSeasons(cache: ListableRawCache): Promise<number[]> {
  const keys = await cache.list('afltables/seasons/');
  return keys
    .map((k) => /\/(\d{4})\.html$/.exec(k)?.[1])
    .filter((y): y is string => y !== undefined)
    .map(Number);
}

/** Step 1: `sql/schema.sql`. */
export async function applySchema(conn: DuckDBConnection): Promise<void> {
  await exec(conn, await readFile(new URL('schema.sql', SQL_DIR), 'utf8'));
}

/** Step 4: the generated `team_match` view, then `sql/models/*.sql` in filename order. */
export async function runModels(conn: DuckDBConnection): Promise<void> {
  await exec(conn, teamMatchViewSql(await statColumns(conn)));
  const files = (await readdir(new URL('models/', SQL_DIR))).filter((f) => f.endsWith('.sql'));
  for (const file of files.sort()) {
    await exec(conn, await readFile(new URL(`models/${file}`, SQL_DIR), 'utf8'));
  }
}

export async function buildWarehouse(options: BuildOptions): Promise<BuildReport> {
  const { conn, cache } = options;
  const log = options.log ?? (() => {});
  await applySchema(conn);

  const batch = new LoadBatch();
  batch.seed();
  // Offline: db:build never touches the network, and needs no contact email.
  const http = createHttpClient({ cache, offline: true });
  const requested = options.seasons ?? (await cachedSeasons(cache));
  const seasons = [...new Set(requested)].sort((a, b) => a - b);
  const notCached: string[] = [];

  for (const season of seasons) {
    const page = await http.get(seasonPageUrl(season));
    const links = parseSeasonPage(decodeHtml(page.body), season);

    /** A Squiggle response from the cache, or [] with a warning naming what is missing. */
    const squiggle = async <T>(what: string, read: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await read();
      } catch (error) {
        if (!(error instanceof OfflineCacheMissError)) throw error;
        batch.warnings.push(
          `${season}: Squiggle ${what} not cached; run npm run ingest -- --season ${season}`,
        );
        return [];
      }
    };
    const games: SquiggleGame[] = await squiggle('games', () => fetchGames(http, season));
    const standings: SquiggleStanding[] = await squiggle('standings', () =>
      fetchStandings(http, season),
    );
    batch.addSquiggle(season, games, standings);
    const index = new SquiggleIndex(games);

    let loaded = 0;
    for (const link of links) {
      let body: Buffer;
      let fetchedAt: string;
      try {
        ({ body, fetchedAt } = await http.get(link.url));
      } catch (error) {
        if (!(error instanceof OfflineCacheMissError)) throw error;
        notCached.push(link.matchKey);
        continue;
      }
      const parsed = parseMatchPage(decodeHtml(body), { season, matchKey: link.matchKey });
      // The same key ingest used to decide the page was worth fetching. If the match page
      // disagrees with its season-page row on date or teams, data test 070 reports it.
      batch.addMatch(parsed, index.find(link), fetchedAt);
      loaded += 1;
    }
    log(`  ${season}: ${loaded} of ${links.length} matches cached, ${games.length} Squiggle games`);
  }

  await batch.insert(conn);
  await runModels(conn);

  return {
    seasons,
    matches: batch.rows.match.length,
    playerMatches: batch.rows.player_match.length,
    players: batch.rows.player.length,
    notCached,
    warnings: batch.warnings,
  };
}

const WARNINGS_SHOWN = 20;

async function main(argv: string[]): Promise<number> {
  let values: { raw?: string; db?: string; season?: string[] };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        raw: { type: 'string' },
        db: { type: 'string' },
        season: { type: 'string', multiple: true },
      },
    }));
  } catch (error) {
    console.error((error as Error).message);
    console.error('usage: npm run db:build -- [--raw <dir>] [--db <path>] [--season <YYYY> …]');
    return 2;
  }
  const rawDir = resolve(values.raw ?? join(REPO_ROOT, 'data', 'raw'));
  const dbPath = resolve(values.db ?? join(REPO_ROOT, 'data', 'afl.duckdb'));
  const parsed = values.season?.map(parseSeasonArg);
  const invalid = parsed?.find((s): s is string => typeof s === 'string');
  if (invalid) {
    console.error(invalid);
    console.error('usage: npm run db:build -- [--raw <dir>] [--db <path>] [--season <YYYY> …]');
    return 2;
  }
  const seasons = parsed as number[] | undefined;

  await mkdir(dirname(dbPath), { recursive: true });
  await rm(dbPath, { force: true });
  await rm(`${dbPath}.wal`, { force: true });
  const db = await openDb(dbPath);
  try {
    console.log(`db:build from ${rawDir}`);
    const report = await buildWarehouse({
      conn: db.conn,
      cache: new FsRawCache(rawDir),
      seasons,
      log: (line) => console.log(line),
    });
    console.log(
      `db:build: ${report.seasons.length} season(s) [${report.seasons.join(', ')}], ` +
        `${report.matches} matches, ${report.playerMatches} player rows, ${report.players} players → ${dbPath}`,
    );
    if (report.notCached.length > 0) {
      console.log(`  ${report.notCached.length} season-page matches not cached (run ingest)`);
    }
    console.log(`  ${report.warnings.length} warning(s)`);
    for (const w of report.warnings.slice(0, WARNINGS_SHOWN)) console.log(`    ${w}`);
    if (report.warnings.length > WARNINGS_SHOWN) {
      console.log(`    … and ${report.warnings.length - WARNINGS_SHOWN} more`);
    }
    return 0;
  } catch (error) {
    console.error(`db:build failed: ${(error as Error).message}`);
    return 1;
  } finally {
    closeDb(db);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
