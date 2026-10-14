import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheKeyForUrl, type FsLike, FsRawCache, UncacheableUrlError } from '../src/cache.ts';

const meta = {
  url: 'https://afltables.com/afl/seas/2025.html',
  fetchedAt: '2026-10-14T04:00:00.000Z',
  status: 200,
};
const seasonPage = readFileSync(new URL('./fixtures/afltables/seas-2025.html', import.meta.url));

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'afl-raw-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

describe('cacheKeyForUrl', () => {
  it.each([
    ['https://afltables.com/afl/seas/2025.html', 'afltables/seasons/2025.html'],
    [
      'https://afltables.com/afl/stats/games/2025/141820250511.html',
      'afltables/2025/141820250511.html',
    ],
    [
      'https://afltables.com/afl/stats/players/T/Tom_Lynch1.html',
      'afltables/players/T/Tom_Lynch1.html',
    ],
    [
      'https://afltables.com/afl/stats/players/A/Alex_Neal-Bullen.html',
      'afltables/players/A/Alex_Neal-Bullen.html',
    ],
  ])('maps %s', (url, key) => {
    expect(cacheKeyForUrl(url)).toBe(key);
  });

  it('keys Squiggle responses by the sha1 of the query string', () => {
    const query = 'q=games;year=2025';
    const sha1 = createHash('sha1').update(query).digest('hex');
    expect(cacheKeyForUrl(`https://api.squiggle.com.au/?${query}`)).toBe(`squiggle/${sha1}.json`);
    expect(cacheKeyForUrl('https://api.squiggle.com.au/?q=teams')).not.toBe(
      cacheKeyForUrl('https://api.squiggle.com.au/?q=games;year=2025'),
    );
  });

  it.each([
    'http://afltables.com/afl/seas/2025.html',
    'https://www.afltables.com/afl/seas/2025.html',
    'https://afltables.com/afl/seas/2025.html?x=1',
    'https://afltables.com/afl/stats/2025.html',
    'https://afltables.com/afl/stats/players/T/../../etc.html',
    'https://afltables.com/afl/stats/games/2025/1418.html',
    'https://api.squiggle.com.au/',
    'https://example.com/?q=teams',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => cacheKeyForUrl(url)).toThrow(UncacheableUrlError);
  });

  it('never decodes percent-encoding, so an encoded slug cannot traverse', () => {
    expect(cacheKeyForUrl('https://afltables.com/afl/stats/players/T/%2E%2E.html')).toBe(
      'afltables/players/T/%2E%2E.html',
    );
  });
});

describe('FsRawCache', () => {
  it('round-trips the raw bytes through gzip, byte for byte', async () => {
    const cache = new FsRawCache(root);
    await cache.put('afltables/seasons/2025.html', seasonPage, meta);

    const entry = await cache.get('afltables/seasons/2025.html');
    expect(entry?.meta).toEqual(meta);
    expect(entry?.body.equals(seasonPage)).toBe(true);

    const gz = await fs.readFile(join(root, 'afltables', 'seasons', '2025.html.gz'));
    expect(gunzipSync(gz).equals(seasonPage)).toBe(true);
    const sidecar = await fs.readFile(join(root, 'afltables', 'seasons', '2025.html.meta.json'));
    expect(JSON.parse(sidecar.toString('utf8'))).toEqual(meta);
  });

  it('returns undefined for a miss, and for a body without its meta sidecar', async () => {
    const cache = new FsRawCache(root);
    expect(await cache.get('afltables/seasons/2024.html')).toBeUndefined();

    await cache.put('afltables/seasons/2025.html', seasonPage, meta);
    await fs.rm(join(root, 'afltables', 'seasons', '2025.html.meta.json'));
    expect(await cache.get('afltables/seasons/2025.html')).toBeUndefined();
  });

  it.each([
    ['corrupt meta JSON', '2025.html.meta.json', '{"url": "trunc'],
    ['meta missing fields', '2025.html.meta.json', '{"url": "x"}'],
    ['corrupt gzip body', '2025.html.gz', 'not gzip'],
  ])('treats %s as a miss', async (_, file, content) => {
    const cache = new FsRawCache(root);
    await cache.put('afltables/seasons/2025.html', seasonPage, meta);
    await fs.writeFile(join(root, 'afltables', 'seasons', file), content);
    expect(await cache.get('afltables/seasons/2025.html')).toBeUndefined();
  });

  it('writes atomically and leaves no temp files', async () => {
    const cache = new FsRawCache(root);
    await cache.put('afltables/seasons/2025.html', Buffer.from('old'), meta);
    await cache.put('afltables/seasons/2025.html', seasonPage, { ...meta, status: 200 });
    expect(await listFiles(root)).toEqual(['2025.html.gz', '2025.html.meta.json']);
    expect((await cache.get('afltables/seasons/2025.html'))?.body.equals(seasonPage)).toBe(true);
  });

  it('keeps the previous entry readable, and cleans up, when a write fails', async () => {
    const good = new FsRawCache(root);
    await good.put('afltables/seasons/2025.html', Buffer.from('previous'), meta);

    const failingFs: FsLike = {
      mkdir: (p, o) => fs.mkdir(p, o),
      readFile: (p) => fs.readFile(p),
      writeFile: (p, d) => fs.writeFile(p, d),
      rm: (p, o) => fs.rm(p, o),
      readdir: (p, o) => fs.readdir(p, o),
      rename: async () => {
        throw new Error('disk full');
      },
    };
    const bad = new FsRawCache(root, failingFs);
    await expect(bad.put('afltables/seasons/2025.html', seasonPage, meta)).rejects.toThrow(
      'disk full',
    );

    expect(await listFiles(root)).toEqual(['2025.html.gz', '2025.html.meta.json']);
    const previous = await good.get('afltables/seasons/2025.html');
    expect(previous?.body.toString()).toBe('previous');
    expect(previous?.meta).toEqual(meta);
  });

  it('lists the complete entries under a prefix, sorted, ignoring temp and orphan files', async () => {
    const cache = new FsRawCache(root);
    expect(await cache.list('afltables/seasons/')).toEqual([]);
    await cache.put('afltables/seasons/2025.html', seasonPage, meta);
    await cache.put('afltables/seasons/2003.html', seasonPage, meta);
    await cache.put('afltables/2025/141820250511.html', seasonPage, meta);
    const dir = join(root, 'afltables', 'seasons');
    await fs.writeFile(join(dir, '2024.html.gz'), 'orphan body, no meta');
    await fs.writeFile(join(dir, '2023.html.meta.json'), '{}');
    await fs.writeFile(join(dir, '2022.html.gz.tmp-1-abcd'), 'temp');

    expect(await cache.list('afltables/seasons/')).toEqual([
      'afltables/seasons/2003.html',
      'afltables/seasons/2025.html',
    ]);
    expect(await cache.list('afltables/')).toEqual([
      'afltables/2025/141820250511.html',
      'afltables/seasons/2003.html',
      'afltables/seasons/2025.html',
    ]);
  });

  it.each(['../escape.html', 'a/../../b', '/abs.html', 'a\\b.html', 'C:/x.html', 'a//b'])(
    'rejects the unsafe key %s',
    async (key) => {
      const cache = new FsRawCache(root);
      await expect(cache.put(key, seasonPage, meta)).rejects.toThrow(/Unsafe/);
      await expect(cache.get(key)).rejects.toThrow(/Unsafe/);
    },
  );
});
