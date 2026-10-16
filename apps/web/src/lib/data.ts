/**
 * Loads the published `v1` JSON files (proposal §10, §11): `fetch` with an in-memory cache keyed
 * by URL. Types come from core with `import type`, so no schema code reaches the bundle.
 */
import type { MatchDetailFile, MetaFile, SeasonLadderFile, SeasonMatchesFile } from '@afl/core';

/** A data file that doesn't exist. */
export class DataNotFoundError extends Error {
  constructor(readonly url: string) {
    super(`${url}: not found`);
    this.name = 'DataNotFoundError';
  }
}

const cache = new Map<string, Promise<unknown>>();

/** For tests. */
export function clearDataCache(): void {
  cache.clear();
}

export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/v1/${path}`;
}

/**
 * One request per URL: concurrent callers share it, and a failed request is forgotten so the next
 * call retries. Cloudflare Pages answers a missing file with `index.html` (200, text/html), so a
 * non-JSON response counts as not found, like a 404.
 */
export function fetchJson<T>(url: string): Promise<T> {
  let request = cache.get(url) as Promise<T> | undefined;
  if (!request) {
    request = (async () => {
      const response = await fetch(url);
      if (response.status === 404) throw new DataNotFoundError(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.includes('json')) throw new DataNotFoundError(url);
      return (await response.json()) as T;
    })();
    request.catch(() => cache.delete(url));
    cache.set(url, request);
  }
  return request;
}

export const getMeta = () => fetchJson<MetaFile>(dataUrl('meta.json'));

export const getSeasonLadder = (season: number) =>
  fetchJson<SeasonLadderFile>(dataUrl(`seasons/${season}/ladder.json`));

export const getSeasonMatches = (season: number) =>
  fetchJson<SeasonMatchesFile>(dataUrl(`seasons/${season}/matches.json`));

export const getMatch = (season: number, matchId: string) =>
  fetchJson<MatchDetailFile>(dataUrl(`matches/${season}/${matchId}.json`));
