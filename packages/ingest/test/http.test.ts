import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cacheKeyForUrl,
  type RawCache,
  type RawCacheEntry,
  type RawCacheMeta,
  UncacheableUrlError,
} from '../src/cache.ts';
import {
  contactEmailFromEnv,
  createHttpClient,
  type HttpClientOptions,
  HttpError,
  MissingContactEmailError,
  NetworkError,
  NotFoundError,
  OfflineCacheMissError,
  RunAbortedError,
} from '../src/http.ts';

const EMAIL = 'crawler@example.com';
const SEASON = 'https://afltables.com/afl/seas/2025.html';
const MATCH = 'https://afltables.com/afl/stats/games/2025/141820250511.html';
const GAMES = 'https://api.squiggle.com.au/?q=games;year=2025';
const TEAMS = 'https://api.squiggle.com.au/?q=teams';
const START = Date.parse('2026-10-14T00:00:00.000Z');

class MemoryCache implements RawCache {
  readonly entries = new Map<string, RawCacheEntry>();
  puts = 0;
  async get(key: string) {
    return this.entries.get(key);
  }
  async has(key: string) {
    return this.entries.has(key);
  }
  async put(key: string, body: Buffer, meta: RawCacheMeta) {
    this.puts += 1;
    this.entries.set(key, { body, meta });
  }
  seed(url: string, body: string, fetchedAt = new Date(START).toISOString()) {
    this.entries.set(cacheKeyForUrl(url), {
      body: Buffer.from(body),
      meta: { url, fetchedAt, status: 200 },
    });
  }
}

/** A status, a status with headers, a thrown error, or a custom handler. */
type Reply =
  | number
  | [number, Record<string, string>]
  | Error
  | ((init: RequestInit) => Promise<Response>);

function setup(replies: Reply[] = [], options: Partial<HttpClientOptions> = {}) {
  let t = START;
  const sleeps: number[] = [];
  const calls: { url: string; at: number; userAgent: string | undefined }[] = [];
  const pending = [...replies];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), at: t, userAgent: headers['User-Agent'] });
    const reply = pending.shift() ?? 200;
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(init);
    const [status, replyHeaders] = typeof reply === 'number' ? [reply, {}] : reply;
    return new Response(status === 200 ? `page ${calls.length}` : 'error', {
      status,
      headers: replyHeaders,
    });
  });
  const cache = new MemoryCache();
  const client = createHttpClient({
    cache,
    contactEmail: EMAIL,
    fetch,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    ...options,
  });
  return { client, fetch, calls, sleeps, cache, advance: (ms: number) => (t += ms) };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the promise to reject');
}

/** Milliseconds between the starts of consecutive requests. */
function gaps(calls: { at: number }[]): number[] {
  return calls.slice(1).map((call, i) => call.at - (calls[i]?.at ?? Number.NaN));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('User-Agent and contact email', () => {
  it('sends the project User-Agent with the contact email', async () => {
    const { client, calls } = setup();
    await client.get(SEASON);
    expect(calls[0]?.userAgent).toBe(`AFL_Stats (github.com/S3R4-PH1M/AFL_Stats; ${EMAIL})`);
  });

  it.each([undefined, '', '   ', 'not-an-email', 'a@b', `${EMAIL}\r\nX-Injected: 1`])(
    'refuses to start with contact email %j, without echoing it',
    (contactEmail) => {
      let error: unknown;
      try {
        createHttpClient({ cache: new MemoryCache(), contactEmail });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(MissingContactEmailError);
      expect((error as Error).message).not.toContain('@');
    },
  );

  it('reads CONTACT_EMAIL from the environment', () => {
    expect(contactEmailFromEnv({ CONTACT_EMAIL: ` ${EMAIL} ` })).toBe(EMAIL);
    expect(contactEmailFromEnv({ CONTACT_EMAIL: '  ' })).toBeUndefined();
    expect(contactEmailFromEnv({})).toBeUndefined();
  });

  it('never puts the email in error messages', async () => {
    const { client } = setup([403, 404, 503, 503, 503, 503]);
    const errors = [
      await failure(client.get(SEASON)),
      await failure(client.get(MATCH)),
      await failure(client.get(GAMES)),
    ];
    for (const e of errors) expect(e.message).not.toContain(EMAIL);
  });
});

describe('throttle', () => {
  it('spaces AFL Tables requests at least 2,000 ms apart', async () => {
    const { client, calls } = setup();
    await client.get(SEASON);
    await client.get(MATCH);
    expect(gaps(calls)).toEqual([2000]);
  });

  it('spaces Squiggle requests at least 1,000 ms apart', async () => {
    const { client, calls, sleeps } = setup();
    await client.get(TEAMS);
    await client.get(GAMES);
    expect(gaps(calls)).toEqual([1000]);
    expect(sleeps).toEqual([1000]);
  });

  it('does not wait again when the gap has already passed', async () => {
    const { client, sleeps, advance } = setup();
    await client.get(SEASON);
    advance(5000);
    await client.get(MATCH);
    expect(sleeps).toEqual([]);
  });

  it('runs concurrent calls one at a time, still spaced', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return new Response('ok');
    };
    const { client, calls } = setup([slow, slow, slow]);
    await Promise.all([
      client.get(SEASON),
      client.get(MATCH),
      client.get('https://afltables.com/afl/seas/2024.html'),
    ]);
    expect(maxInFlight).toBe(1);
    expect(gaps(calls)).toEqual([2000, 2000]);
  });

  it('fetches a URL requested twice concurrently only once', async () => {
    const { client, calls } = setup();
    const [a, b] = await Promise.all([client.get(SEASON), client.get(SEASON)]);
    expect(calls).toHaveLength(1);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
  });
});

describe('retries', () => {
  it('retries a 503 and succeeds', async () => {
    const { client, fetch, sleeps } = setup([503, 200]);
    const result = await client.get(SEASON);
    expect(result.fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2000]);
  });

  it('backs off 2 s, 4 s, 8 s, then gives up after 4 attempts', async () => {
    const { client, fetch, sleeps } = setup([503, 502, 500, 503]);
    const error = await failure(client.get(SEASON));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([2000, 4000, 8000]);
  });

  it('honours Retry-After in seconds and as an HTTP date', async () => {
    const seconds = setup([[429, { 'Retry-After': '7' }], 200]);
    await seconds.client.get(SEASON);
    expect(seconds.sleeps).toEqual([7000]);

    const date = setup([[503, { 'Retry-After': new Date(START + 10_000).toUTCString() }], 200]);
    await date.client.get(SEASON);
    expect(date.sleeps).toEqual([10_000]);

    const short = setup([[503, { 'Retry-After': '1' }], 200]);
    await short.client.get(SEASON);
    expect(short.sleeps).toEqual([2000]);
  });

  it('fails instead of waiting for an excessive Retry-After', async () => {
    const { client, fetch } = setup([[429, { 'Retry-After': '600' }]]);
    const error = await failure(client.get(SEASON));
    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).toMatch(/Retry-After/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries network errors', async () => {
    const { client, fetch } = setup([new TypeError('fetch failed'), 200]);
    expect((await client.get(SEASON)).fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404, and reports it as NotFoundError', async () => {
    const { client, fetch, cache } = setup([404]);
    const error = await failure(client.get(MATCH));
    expect(error).toBeInstanceOf(NotFoundError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.puts).toBe(0);
  });

  it('does not retry other 4xx responses', async () => {
    const { client, fetch } = setup([403]);
    const error = await failure(client.get(SEASON));
    expect(error).toBeInstanceOf(HttpError);
    expect(error).not.toBeInstanceOf(NotFoundError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out a hung request after 30 s and retries', async () => {
    vi.useFakeTimers();
    const hang = (init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const { client, fetch } = setup([hang, 200]);
    const result = client.get(SEASON);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('abort after consecutive failures', () => {
  it('aborts the run on the fifth consecutive failure and refuses later calls', async () => {
    const { client, fetch } = setup([503, 503, 503, 503, 503]);
    expect(await failure(client.get(SEASON))).toBeInstanceOf(HttpError);
    expect(await failure(client.get(MATCH))).toBeInstanceOf(RunAbortedError);
    expect(fetch).toHaveBeenCalledTimes(5);

    expect(await failure(client.get(GAMES))).toBeInstanceOf(RunAbortedError);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('counts non-retryable 4xx responses', async () => {
    const { client } = setup([403, 403, 403, 403, 403]);
    for (let i = 0; i < 4; i++) {
      expect(await failure(client.get(SEASON))).toBeInstanceOf(HttpError);
    }
    expect(await failure(client.get(SEASON))).toBeInstanceOf(RunAbortedError);
  });

  it('resets the count on a success', async () => {
    // Without the reset, TEAMS' first request would be the fifth failure in a row.
    const { client, fetch } = setup([503, 503, 503, 503, 200, 503, 503, 503, 200]);
    expect(await failure(client.get(SEASON))).toBeInstanceOf(HttpError);
    expect((await client.get(GAMES)).fromCache).toBe(false);
    expect((await client.get(TEAMS)).fromCache).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it('neither counts nor resets on a 404', async () => {
    const { client, fetch } = setup([503, 503, 503, 503, 404, 410, 503]);
    expect(await failure(client.get(SEASON))).toBeInstanceOf(HttpError);
    expect(await failure(client.get(MATCH))).toBeInstanceOf(NotFoundError);
    expect(
      await failure(client.get('https://afltables.com/afl/stats/games/2025/010520250322.html')),
    ).toBeInstanceOf(NotFoundError);
    expect(await failure(client.get(GAMES))).toBeInstanceOf(RunAbortedError);
    expect(fetch).toHaveBeenCalledTimes(7);
  });
});

describe('redirects and error detail', () => {
  it('does not follow redirects, and fails without retrying', async () => {
    const { client, fetch, cache } = setup([[301, { Location: 'http://elsewhere.example/' }]]);
    const error = await failure(client.get(SEASON));
    expect(error).toBeInstanceOf(HttpError);
    expect(error.message).toContain('redirect to http://elsewhere.example/');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
    expect(cache.puts).toBe(0);
  });

  it('reports the low-level cause of a network error', async () => {
    const dns = () =>
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND afltables.com'), {
          code: 'ENOTFOUND',
        }),
      });
    const { client } = setup([dns(), dns(), dns(), dns()]);
    const error = await failure(client.get(SEASON));
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.message).toContain('TypeError: ENOTFOUND');
    expect(error.message).not.toContain(EMAIL);
  });
});

describe('cache and refresh policy', () => {
  it('serves a cache hit without calling fetch', async () => {
    const { client, fetch, cache } = setup();
    cache.seed(SEASON, 'cached');
    const result = await client.get(SEASON);
    expect(result).toMatchObject({ fromCache: true, status: 200 });
    expect(result.body.toString()).toBe('cached');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stores only successful responses, with url, fetchedAt and status', async () => {
    const { client, cache } = setup([200]);
    const result = await client.get(GAMES);
    const entry = cache.entries.get(cacheKeyForUrl(GAMES));
    expect(entry?.meta).toEqual({ url: GAMES, fetchedAt: result.fetchedAt, status: 200 });
    expect(entry?.body.toString()).toBe('page 1');
  });

  it('re-fetches with force, but only once per run', async () => {
    const { client, fetch, cache } = setup();
    cache.seed(MATCH, 'old');
    const first = await client.get(MATCH, { force: true });
    expect(first.fromCache).toBe(false);
    expect(first.body.toString()).toBe('page 1');
    const second = await client.get(MATCH, { force: true });
    expect(second.fromCache).toBe(true);
    expect(second.body.toString()).toBe('page 1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches stale entries per maxAgeMs, at most once per run', async () => {
    const { client, fetch, cache } = setup();
    cache.seed(SEASON, 'an hour old', new Date(START - 3_600_000).toISOString());
    expect((await client.get(SEASON, { maxAgeMs: 7_200_000 })).fromCache).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect((await client.get(SEASON, { maxAgeMs: 0 })).fromCache).toBe(false);
    expect((await client.get(SEASON, { maxAgeMs: 0 })).fromCache).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats equivalent URLs as one page for the once-per-run rule', async () => {
    const { client, fetch } = setup();
    await client.get('https://api.squiggle.com.au?q=teams', { force: true });
    const again = await client.get('https://api.squiggle.com.au/?q=teams', { force: true });
    expect(again.fromCache).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 503 after retries', [503, 503, 503, 503], HttpError],
    ['a 404', [404], NotFoundError],
    [
      'a network error',
      [new TypeError('a'), new TypeError('b'), new TypeError('c'), new TypeError('d')],
      NetworkError,
    ],
  ] as const)(
    'falls back to the stale copy when a maxAgeMs refresh hits %s',
    async (_, replies, type) => {
      const { client, cache } = setup([...replies]);
      cache.seed(SEASON, 'stale', new Date(START - 3_600_000).toISOString());
      const result = await client.get(SEASON, { maxAgeMs: 0 });
      expect(result.fromCache).toBe(true);
      expect(result.body.toString()).toBe('stale');
      expect(result.refreshError).toBeInstanceOf(type);
    },
  );

  it('does not fall back for force, or when the run aborts', async () => {
    const forced = setup([404]);
    forced.cache.seed(SEASON, 'cached');
    expect(await failure(forced.client.get(SEASON, { force: true }))).toBeInstanceOf(NotFoundError);

    const aborting = setup([503, 503, 503, 503, 503]);
    aborting.cache.seed(SEASON, 'stale', new Date(START - 3_600_000).toISOString());
    expect(await failure(aborting.client.get(MATCH))).toBeInstanceOf(HttpError);
    expect(await failure(aborting.client.get(SEASON, { maxAgeMs: 0 }))).toBeInstanceOf(
      RunAbortedError,
    );
  });

  it('offline: serves any cached copy, errors on a miss, needs no email', async () => {
    const { client, fetch, cache } = setup([], { offline: true, contactEmail: undefined });
    cache.seed(SEASON, 'stale', new Date(START - 86_400_000).toISOString());
    expect((await client.get(SEASON, { force: true, maxAgeMs: 0 })).fromCache).toBe(true);
    expect(await failure(client.get(MATCH))).toBeInstanceOf(OfflineCacheMissError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects URLs outside the known sources and page types', async () => {
    const { client, fetch } = setup();
    expect(await failure(client.get('https://example.com/afl/seas/2025.html'))).toBeInstanceOf(
      UncacheableUrlError,
    );
    expect(await failure(client.get('https://afltables.com/afl/afl_index.html'))).toBeInstanceOf(
      UncacheableUrlError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the global fetch by default, which the test setup blocks', async () => {
    const { client, cache } = setup([], { fetch: undefined });
    expect(await failure(client.get(SEASON))).toBeInstanceOf(NetworkError);
    expect(cache.puts).toBe(0);
  });
});
