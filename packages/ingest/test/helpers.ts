import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeHtml } from '../src/afltables/decode.ts';

/** Raw bytes of an M1a fixture in `test/fixtures` (tests only). */
export function readFixtureBytes(path: string): Buffer {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

/** An AFL Tables fixture decoded the way the build will decode the raw cache. */
export function readAfltables(name: string): string {
  return decodeHtml(readFixtureBytes(`afltables/${name}`));
}

/** The five M1a match fixtures, with the season and match key encoded in each file name. */
export const MATCH_FIXTURES = [
  '2025-141820250511',
  '2025-010520250322',
  '2025-091920250927',
  '2025-121920250511',
  '2003-010320030629',
].map((name) => {
  const [season, matchKey] = name.split('-') as [string, string];
  return { name, season: Number(season), matchKey };
});

/** Source URL of each M1a fixture (fixtures/README.md), keyed by fixture path. */
export const FIXTURE_URLS: Readonly<Record<string, string>> = {
  'afltables/seas-2025.html': 'https://afltables.com/afl/seas/2025.html',
  'afltables/seas-2003.html': 'https://afltables.com/afl/seas/2003.html',
  ...Object.fromEntries(
    MATCH_FIXTURES.map(({ name, season, matchKey }) => [
      `afltables/${name}.html`,
      `https://afltables.com/afl/stats/games/${season}/${matchKey}.html`,
    ]),
  ),
  'squiggle/teams.json': 'https://api.squiggle.com.au/?q=teams',
  'squiggle/games-2025.json': 'https://api.squiggle.com.au/?q=games;year=2025',
  'squiggle/standings-2025.json': 'https://api.squiggle.com.au/?q=standings;year=2025',
};

/** Fixture bytes keyed by source URL. */
export function fixturesByUrl(): Map<string, Buffer | number> {
  return new Map(
    Object.entries(FIXTURE_URLS).map(([path, url]) => [url, readFixtureBytes(path)] as const),
  );
}

/**
 * A fake `fetch` serving `routes` by URL (a number is that status with no page) and 404 for
 * anything else. Every requested URL is recorded in `calls`.
 */
export function fakeFetch(routes: Map<string, Buffer | number>) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const route = routes.get(url) ?? 404;
    return typeof route === 'number'
      ? new Response('error', { status: route })
      : new Response(new Uint8Array(route), { status: 200 });
  };
  return { fetch, calls };
}

/** A fresh temp directory; `cleanup` removes it. */
export async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'afl-ingest-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
