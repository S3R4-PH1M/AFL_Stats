import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meta } from '../test/sample.ts';
import {
  clearDataCache,
  DataNotFoundError,
  dataUrl,
  fetchJson,
  getMatch,
  getMeta,
  getSeasonLadder,
  getSeasonMatches,
} from './data.ts';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearDataCache();
  fetchMock = vi.fn(async () => json(meta));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('data URLs', () => {
  it('points at the v1 files', () => {
    expect(dataUrl('meta.json')).toBe('/data/v1/meta.json');
  });

  it('builds each file path', async () => {
    await getMeta();
    await getSeasonLadder(2025);
    await getSeasonMatches(2025);
    await getMatch(2025, '141820250511');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/data/v1/meta.json',
      '/data/v1/seasons/2025/ladder.json',
      '/data/v1/seasons/2025/matches.json',
      '/data/v1/matches/2025/141820250511.json',
    ]);
  });
});

describe('fetchJson', () => {
  it('fetches once per URL and serves repeats from memory', async () => {
    expect(await fetchJson('/data/v1/meta.json')).toEqual(meta);
    expect(await fetchJson('/data/v1/meta.json')).toEqual(meta);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const [a, b] = await Promise.all([fetchJson('/x.json'), fetchJson('/x.json')]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed request so the next call retries', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(fetchJson('/x.json')).rejects.toThrow('offline');
    expect(await fetchJson('/x.json')).toEqual(meta);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('raises DataNotFoundError on a 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('missing', { status: 404 }));
    await expect(fetchJson('/missing.json')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('raises DataNotFoundError when the SPA fallback serves index.html instead', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(fetchJson('/missing.json')).rejects.toBeInstanceOf(DataNotFoundError);
  });

  it('raises a plain error for other HTTP failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const error = await fetchJson('/x.json').catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(DataNotFoundError);
    expect((error as Error).message).toBe('/x.json: HTTP 500');
  });
});
