/**
 * Raw cache of fetched pages (proposal §8.2, task 9.2).
 *
 * Bytes are stored exactly as served (gzipped); charset decoding happens at parse time (§6.4.7).
 * M1 has only the local filesystem backend. `R2RawCache` arrives in M2 behind the same interface.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface RawCacheMeta {
  url: string;
  fetchedAt: string;
  status: number;
}

export interface RawCacheEntry {
  body: Buffer;
  meta: RawCacheMeta;
}

export interface RawCache {
  get(key: string): Promise<RawCacheEntry | undefined>;
  put(key: string, body: Buffer, meta: RawCacheMeta): Promise<void>;
}

/** A cache that can enumerate its keys (`db:build` finds the cached seasons; R2 lists in M2). */
export interface ListableRawCache extends RawCache {
  /** Keys of complete entries (body and meta) under `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

export class UncacheableUrlError extends Error {
  constructor(url: string) {
    super(`No raw-cache layout for URL ${url}`);
    this.name = 'UncacheableUrlError';
  }
}

/**
 * Maps a source URL to its cache key (§8.2). Only the four known page types are accepted,
 * which doubles as the allowlist of URLs the crawler may fetch.
 *
 * | URL                                              | Key                                |
 * |--------------------------------------------------|------------------------------------|
 * | afltables.com/afl/seas/{year}.html               | afltables/seasons/{year}.html      |
 * | afltables.com/afl/stats/games/{year}/{key}.html  | afltables/{year}/{key}.html        |
 * | afltables.com/afl/stats/players/{L}/{slug}.html  | afltables/players/{L}/{slug}.html  |
 * | api.squiggle.com.au/?{query}                     | squiggle/{sha1(query)}.json        |
 */
export function cacheKeyForUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UncacheableUrlError(url);
  }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.hash) {
    throw new UncacheableUrlError(url);
  }

  if (parsed.host === 'afltables.com' && !parsed.search) {
    const p = parsed.pathname;
    const season = /^\/afl\/seas\/(\d{4})\.html$/.exec(p);
    if (season) return `afltables/seasons/${season[1]}.html`;
    const match = /^\/afl\/stats\/games\/(\d{4})\/(\d{12})\.html$/.exec(p);
    if (match) return `afltables/${match[1]}/${match[2]}.html`;
    const player = /^\/afl\/stats\/players\/([A-Z])\/([^/]+)\.html$/.exec(p);
    if (player && isSafeKey(`${player[1]}/${player[2]}`)) {
      return `afltables/players/${player[1]}/${player[2]}.html`;
    }
  }

  if (
    parsed.host === 'api.squiggle.com.au' &&
    parsed.pathname === '/' &&
    parsed.search.length > 1
  ) {
    const query = parsed.search.slice(1);
    return `squiggle/${createHash('sha1').update(query).digest('hex')}.json`;
  }

  throw new UncacheableUrlError(url);
}

/** Relative, forward-slash keys only: no `..`, `.` or empty segments, no backslashes or drives. */
function isSafeKey(key: string): boolean {
  if (/[\\:\0]/.test(key)) return false;
  return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The subset of `node:fs/promises` used by `FsRawCache`; injectable to simulate failures. */
export interface FsLike {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
  readdir(path: string, options: { recursive: true }): Promise<string[]>;
}

/**
 * Local mirror in `data/raw/`. Each entry is `{key}.gz` plus a `{key}.meta.json` sidecar.
 * A body without a sidecar, or an unreadable entry, is a miss, so an online run refetches it.
 */
export class FsRawCache implements ListableRawCache {
  constructor(
    readonly rootDir: string,
    private readonly fs: FsLike = nodeFs,
  ) {}

  async get(key: string): Promise<RawCacheEntry | undefined> {
    const paths = this.paths(key);
    const metaText = await readIfExists(this.fs, paths.meta);
    if (metaText === undefined) return undefined;
    const gz = await readIfExists(this.fs, paths.body);
    if (gz === undefined) return undefined;
    try {
      const meta = parseMeta(metaText.toString('utf8'));
      return meta && { body: await gunzipAsync(gz), meta };
    } catch {
      return undefined; // corrupt JSON or gzip
    }
  }

  /**
   * Both files are written to temp names first, then renamed body-then-meta. A failure before
   * the renames leaves the previous entry untouched.
   */
  async put(key: string, body: Buffer, meta: RawCacheMeta): Promise<void> {
    const paths = this.paths(key);
    await this.fs.mkdir(dirname(paths.body), { recursive: true });
    const bodyTmp = tempName(paths.body);
    const metaTmp = tempName(paths.meta);
    try {
      await this.fs.writeFile(bodyTmp, await gzipAsync(body));
      await this.fs.writeFile(metaTmp, `${JSON.stringify(meta, null, 2)}\n`);
      await this.fs.rename(bodyTmp, paths.body);
      await this.fs.rename(metaTmp, paths.meta);
    } catch (error) {
      await this.fs.rm(bodyTmp, { force: true });
      await this.fs.rm(metaTmp, { force: true });
      throw error;
    }
  }

  /** Entries with both a body and a sidecar; temp files and orphans are skipped. */
  async list(prefix: string): Promise<string[]> {
    const dir = prefix.replace(/\/+$/, '');
    if (dir !== '' && !isSafeKey(dir)) throw new Error(`Unsafe raw-cache prefix "${prefix}"`);
    let files: string[];
    try {
      files = await this.fs.readdir(join(this.rootDir, ...dir.split('/')), { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const names = new Set(files.map((f) => (dir ? `${dir}/` : '') + f.replaceAll('\\', '/')));
    return [...names]
      .filter((n) => n.endsWith('.meta.json'))
      .map((n) => n.slice(0, -'.meta.json'.length))
      .filter((key) => names.has(`${key}.gz`))
      .sort();
  }

  private paths(key: string): { body: string; meta: string } {
    if (!isSafeKey(key)) throw new Error(`Unsafe raw-cache key "${key}"`);
    const base = join(this.rootDir, ...key.split('/'));
    return { body: `${base}.gz`, meta: `${base}.meta.json` };
  }
}

function tempName(target: string): string {
  return `${target}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
}

function parseMeta(text: string): RawCacheMeta | undefined {
  const value = JSON.parse(text) as Partial<RawCacheMeta> | null;
  if (
    typeof value?.url !== 'string' ||
    typeof value.fetchedAt !== 'string' ||
    typeof value.status !== 'number'
  ) {
    return undefined;
  }
  return { url: value.url, fetchedAt: value.fetchedAt, status: value.status };
}

async function readIfExists(fs: FsLike, path: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
