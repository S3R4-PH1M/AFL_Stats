import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKeyForUrl, FsRawCache } from '@afl/ingest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_FETCHED_AT, FIXTURE_URLS } from './fixtureCache.ts';
import { seedRaw } from './seedRaw.ts';

let dir: string;
let lines: string[];
const log = (line: string) => lines.push(line);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'afl-seed-'));
  lines = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('fixtures:seed', () => {
  it('writes every fixture under its real cache key and fetch time', async () => {
    const raw = join(dir, 'raw');
    expect(await seedRaw(['--raw', raw], log)).toBe(0);
    const cache = new FsRawCache(raw);
    for (const url of Object.values(FIXTURE_URLS)) {
      const entry = await cache.get(cacheKeyForUrl(url));
      expect(entry?.meta).toMatchObject({ url, fetchedAt: FIXTURE_FETCHED_AT, status: 200 });
    }
    expect(lines.at(-1)).toMatch(/10 fixture pages/);
  });

  it('refuses a non-empty directory, so a real raw cache is never overwritten', async () => {
    await writeFile(join(dir, 'keep.txt'), 'real cache');
    expect(await seedRaw(['--raw', dir], log)).toBe(2);
    expect(await readdir(dir)).toEqual(['keep.txt']);
  });

  it('seeds a non-empty directory with --force', async () => {
    await writeFile(join(dir, 'keep.txt'), 'real cache');
    expect(await seedRaw(['--raw', dir, '--force'], log)).toBe(0);
    expect((await readdir(dir)).length).toBeGreaterThan(1);
  });

  it.each([[[]], [['--raw']], [['--raw', 'x', '--bogus']]])('exits 2 for %j', async (argv) => {
    expect(await seedRaw(argv, log)).toBe(2);
  });
});
