/**
 * The only way the project talks to Squiggle and AFL Tables (proposal §6.5, task 9.2).
 *
 * - User-Agent with the project URL and a contact email; refuses to start without one.
 * - One request at a time through a single queue, at least 2 s apart for AFL Tables and 1 s for Squiggle.
 * - 30 s timeout. 429, 5xx and network errors back off 2 s, 4 s, 8 s, honouring `Retry-After`.
 * - Other 4xx fail at once. Five consecutive failed requests abort the run.
 * - Every successful response goes to the raw cache; cache hits never touch the network.
 *
 * The UA and email are never logged or put in error messages.
 */
import { cacheKeyForUrl, type RawCache, type RawCacheEntry } from './cache.ts';

const PROJECT = 'AFL_Stats (github.com/S3R4-PH1M/AFL_Stats';

/** Minimum gap between the end of one request and the start of the next, per host. */
export const MIN_GAP_MS: Readonly<Record<string, number>> = {
  'afltables.com': 2000,
  'api.squiggle.com.au': 1000,
};

export const BACKOFF_MS: readonly number[] = [2000, 4000, 8000];
export const MAX_RETRY_AFTER_MS = 5 * 60_000;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpClientOptions {
  cache: RawCache;
  /** Required unless `offline`. Read it with `contactEmailFromEnv()`. */
  contactEmail?: string | undefined;
  /** Never touch the network: serve any cached copy and turn a miss into an error. */
  offline?: boolean | undefined;
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  timeoutMs?: number | undefined;
}

export interface GetOptions {
  /** Re-fetch even when cached (still at most once per run). */
  force?: boolean | undefined;
  /** Treat a cached copy older than this as stale (still at most once per run). */
  maxAgeMs?: number | undefined;
}

export interface GetResult {
  body: Buffer;
  fromCache: boolean;
  fetchedAt: string;
  status: number;
}

export interface HttpClient {
  get(url: string, options?: GetOptions): Promise<GetResult>;
}

export class MissingContactEmailError extends Error {
  constructor() {
    super(
      'CONTACT_EMAIL is missing or invalid. The crawler User-Agent needs a contact email (proposal §6.1).',
    );
    this.name = 'MissingContactEmailError';
  }
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    detail = '',
  ) {
    super(`HTTP ${status} for ${url}${detail ? ` (${detail})` : ''}`);
    this.name = 'HttpError';
  }
}

/** 404 or 410. Not counted towards the abort limit: AFL Tables can lag a day or two (A2). */
export class NotFoundError extends HttpError {
  constructor(url: string, status: number) {
    super(url, status);
    this.name = 'NotFoundError';
  }
}

export class NetworkError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`Request failed for ${url}: ${reason}`);
    this.name = 'NetworkError';
  }
}

export class RunAbortedError extends Error {
  constructor(last: string) {
    super(
      `Aborting the run after ${MAX_CONSECUTIVE_FAILURES} consecutive failed requests (last: ${last})`,
    );
    this.name = 'RunAbortedError';
  }
}

export class OfflineCacheMissError extends Error {
  constructor(readonly url: string) {
    super(`Offline and not in the raw cache: ${url}`);
    this.name = 'OfflineCacheMissError';
  }
}

/** Reads `CONTACT_EMAIL`, returning undefined when unset or blank. */
export function contactEmailFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.CONTACT_EMAIL?.trim() || undefined;
}

export function userAgent(contactEmail: string): string {
  return `${PROJECT}; ${contactEmail})`;
}

const EMAIL = /^[^\s@()<>,;"]+@[^\s@()<>,;"]+\.[^\s@()<>,;"]+$/;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Attempt =
  | { kind: 'response'; status: number; headers: Headers; body: Buffer }
  | { kind: 'error'; reason: string };

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const {
    cache,
    offline = false,
    fetch: fetchImpl = globalThis.fetch,
    now = Date.now,
    sleep = defaultSleep,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const email = options.contactEmail?.trim();
  if (!offline && (!email || !EMAIL.test(email))) throw new MissingContactEmailError();
  const headers = email ? { 'User-Agent': userAgent(email) } : {};

  let queue: Promise<unknown> = Promise.resolve();
  const lastRequestEnd = new Map<string, number>();
  const fetchedThisRun = new Set<string>();
  let consecutiveFailures = 0;
  let abortedBy: string | undefined;

  function fromCache(entry: RawCacheEntry): GetResult {
    return {
      body: entry.body,
      fromCache: true,
      fetchedAt: entry.meta.fetchedAt,
      status: entry.meta.status,
    };
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function attempt(url: string): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' });
      const body = Buffer.from(await res.arrayBuffer());
      return { kind: 'response', status: res.status, headers: res.headers, body };
    } catch (error) {
      const reason = controller.signal.aborted
        ? `timed out after ${timeoutMs} ms`
        : error instanceof Error
          ? error.name
          : 'unknown error';
      return { kind: 'error', reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Counts a failed request; aborts the run on the fifth in a row. */
  function recordFailure(last: string): void {
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      abortedBy = last;
      throw new RunAbortedError(last);
    }
  }

  function retryAfterMs(value: string | null): number {
    if (!value) return 0;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
    const at = Date.parse(trimmed);
    return Number.isNaN(at) ? 0 : Math.max(0, at - now());
  }

  async function fetchAndStore(url: string, key: string, host: string): Promise<GetResult> {
    if (fetchedThisRun.has(url)) {
      const entry = await cache.get(key);
      if (entry) return fromCache(entry);
    }

    for (let retry = 0; ; retry++) {
      if (abortedBy !== undefined) throw new RunAbortedError(abortedBy);

      const gap = MIN_GAP_MS[host] ?? 0;
      const last = lastRequestEnd.get(host);
      if (last !== undefined) {
        const wait = last + gap - now();
        if (wait > 0) await sleep(wait);
      }

      const result = await attempt(url);
      lastRequestEnd.set(host, now());

      let failure: Error;
      let waitMs = 0;
      if (result.kind === 'response') {
        const { status } = result;
        if (status === 200) {
          consecutiveFailures = 0;
          const fetchedAt = new Date(now()).toISOString();
          await cache.put(key, result.body, { url, fetchedAt, status });
          fetchedThisRun.add(url);
          return { body: result.body, fromCache: false, fetchedAt, status };
        }
        if (status === 404 || status === 410) {
          consecutiveFailures = 0;
          throw new NotFoundError(url, status);
        }
        recordFailure(`HTTP ${status} for ${url}`);
        if (status !== 429 && status < 500) throw new HttpError(url, status);
        failure = new HttpError(url, status);
        waitMs = retryAfterMs(result.headers.get('retry-after'));
        if (waitMs > MAX_RETRY_AFTER_MS) {
          throw new HttpError(
            url,
            status,
            `Retry-After ${Math.round(waitMs / 1000)} s is too long`,
          );
        }
      } else {
        recordFailure(`${result.reason} for ${url}`);
        failure = new NetworkError(url, result.reason);
      }

      const backoff = BACKOFF_MS[retry];
      if (backoff === undefined) throw failure;
      await sleep(Math.max(backoff, waitMs));
    }
  }

  return {
    async get(url, { force = false, maxAgeMs } = {}) {
      const key = cacheKeyForUrl(url);
      const host = new URL(url).host;
      if (!offline && !(host in MIN_GAP_MS)) throw new Error(`Host not allowed: ${host}`);

      const cached = await cache.get(key);
      if (cached) {
        const age = now() - Date.parse(cached.meta.fetchedAt);
        const fresh = maxAgeMs === undefined || age < maxAgeMs;
        if (offline || fetchedThisRun.has(url) || (!force && fresh)) return fromCache(cached);
      } else if (offline) {
        throw new OfflineCacheMissError(url);
      }
      return enqueue(() => fetchAndStore(url, key, host));
    },
  };
}
