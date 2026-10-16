import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKeyForUrl, FsRawCache } from '@afl/ingest';
import { type BuildReport, buildWarehouse } from '../src/build.ts';
import { closeDb, type Db, openDb } from '../src/db.ts';

/** The day the M1a fixtures were fetched (fixtures/README.md), used as `source_fetched_at`. */
export const FIXTURE_FETCHED_AT = '2026-10-14T00:00:00.000Z';

/** Source URL of each M1a fixture in `packages/ingest/test/fixtures` (fixtures/README.md). */
export const FIXTURE_URLS: Readonly<Record<string, string>> = {
  'afltables/seas-2025.html': 'https://afltables.com/afl/seas/2025.html',
  'afltables/seas-2003.html': 'https://afltables.com/afl/seas/2003.html',
  'afltables/2025-141820250511.html':
    'https://afltables.com/afl/stats/games/2025/141820250511.html',
  'afltables/2025-010520250322.html':
    'https://afltables.com/afl/stats/games/2025/010520250322.html',
  'afltables/2025-091920250927.html':
    'https://afltables.com/afl/stats/games/2025/091920250927.html',
  'afltables/2025-121920250511.html':
    'https://afltables.com/afl/stats/games/2025/121920250511.html',
  'afltables/2003-010320030629.html':
    'https://afltables.com/afl/stats/games/2003/010320030629.html',
  'squiggle/teams.json': 'https://api.squiggle.com.au/?q=teams',
  'squiggle/games-2025.json': 'https://api.squiggle.com.au/?q=games;year=2025',
  'squiggle/standings-2025.json': 'https://api.squiggle.com.au/?q=standings;year=2025',
};

export function readFixture(path: string): Buffer {
  return readFileSync(new URL(`../../ingest/test/fixtures/${path}`, import.meta.url));
}

export function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFixture(path).toString('utf8')) as T;
}

/** Writes the fixtures into the raw cache at `dir` under their real cache keys (`fixtures:seed`). */
export async function seedFixtureCache(
  dir: string,
  paths: readonly string[] = Object.keys(FIXTURE_URLS),
): Promise<FsRawCache> {
  const cache = new FsRawCache(dir);
  for (const path of paths) {
    const url = FIXTURE_URLS[path];
    if (!url) throw new Error(`no URL for fixture ${path}`);
    await cache.put(cacheKeyForUrl(url), readFixture(path), {
      url,
      fetchedAt: FIXTURE_FETCHED_AT,
      status: 200,
    });
  }
  return cache;
}

/** A temp-dir `FsRawCache` holding the fixtures under their real cache keys. */
export async function fixtureCache(
  paths: readonly string[] = Object.keys(FIXTURE_URLS),
): Promise<{ cache: FsRawCache; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'afl-warehouse-'));
  const cache = await seedFixtureCache(dir, paths);
  return { cache, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** An in-memory warehouse built from the fixtures. */
export async function buildFixtureDb(): Promise<{ db: Db; report: BuildReport }> {
  const { cache, cleanup } = await fixtureCache();
  const db = await openDb(':memory:');
  try {
    const report = await buildWarehouse({ conn: db.conn, cache });
    return { db, report };
  } catch (error) {
    closeDb(db);
    throw error;
  } finally {
    await cleanup();
  }
}
