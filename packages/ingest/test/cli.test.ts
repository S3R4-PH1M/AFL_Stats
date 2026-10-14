import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSeasonPage } from '../src/afltables/seasonPage.ts';
import { cacheKeyForUrl, FsRawCache } from '../src/cache.ts';
import { type CliIo, main } from '../src/cli.ts';
import { formatSummary, type IngestSummary } from '../src/ingest.ts';
import { fakeFetch, fixturesByUrl, readAfltables, tempDir } from './helpers.ts';

const EMAIL = 'crawler@example.com';
const AFTER_2025 = Date.parse('2026-10-14T00:00:00.000Z');
const SQUIGGLE = [
  'https://api.squiggle.com.au/?q=teams',
  'https://api.squiggle.com.au/?q=games;year=2025',
  'https://api.squiggle.com.au/?q=standings;year=2025',
];
const SEASON = 'https://afltables.com/afl/seas/2025.html';
const FIXTURE_KEYS = ['010520250322', '141820250511', '121920250511', '091920250927'];
const matchUrl = (key: string) => `https://afltables.com/afl/stats/games/2025/${key}.html`;

let root: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: root, cleanup } = await tempDir());
});
afterEach(async () => {
  await cleanup();
});

interface Run {
  code: number;
  out: string;
  err: string;
  calls: string[];
}

async function run(
  args: string[],
  {
    routes = fixturesByUrl(),
    env = { CONTACT_EMAIL: EMAIL } as NodeJS.ProcessEnv,
    now = AFTER_2025,
  } = {},
): Promise<Run> {
  const fake = fakeFetch(routes);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    env,
    rootDir: root,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fetch: fake.fetch,
    sleep: async () => {},
    now: () => now,
  };
  const code = await main(['--cache-dir', join(root, 'raw'), ...args], io);
  return { code, out: out.join('\n'), err: err.join('\n'), calls: fake.calls };
}

const count = (output: string, label: string) =>
  Number(new RegExp(`^ {2}${label} +(\\d+)`, 'm').exec(output)?.[1]);

describe('ingest CLI against the fixtures', () => {
  it('fetches Squiggle, the season page and the uncached completed matches', async () => {
    const r = await run(['--season', '2025']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.calls.slice(0, 4)).toEqual([...SQUIGGLE, SEASON]);
    expect(r.calls).toHaveLength(4 + 216);
    expect(r.out).toContain(
      'ingest 2025: 216 complete in Squiggle (0 not complete), 216 on the AFL Tables season page',
    );
    expect(count(r.out, 'fetched')).toBe(4);
    expect(count(r.out, 'cached')).toBe(0);
    expect(count(r.out, 'not yet published')).toBe(212);
    expect(count(r.out, 'failed')).toBe(0);

    const cache = new FsRawCache(join(root, 'raw'));
    for (const key of FIXTURE_KEYS) {
      expect(await cache.get(cacheKeyForUrl(matchUrl(key)))).toBeDefined();
    }
  });

  it('is safe to re-run: cached pages and a finished season are not requested again', async () => {
    await run(['--season', '2025']);
    const r = await run(['--season', '2025']);
    expect(r.code).toBe(0);
    expect(r.calls).not.toContain(SEASON);
    for (const url of [...SQUIGGLE, ...FIXTURE_KEYS.map(matchUrl)]) {
      expect(r.calls).not.toContain(url);
    }
    expect(r.calls).toHaveLength(212); // only the ones still missing
    expect(count(r.out, 'fetched')).toBe(0);
    expect(count(r.out, 'cached')).toBe(4);
  });

  it('re-fetches Squiggle and the season page once per run during the season', async () => {
    const midSeason = Date.parse('2025-12-01T00:00:00.000Z');
    await run(['--season', '2025'], { now: midSeason });
    const r = await run(['--season', '2025'], { now: midSeason });
    expect(r.calls.slice(0, 4)).toEqual([...SQUIGGLE, SEASON]);
    expect(count(r.out, 'cached')).toBe(4);
  });

  it('re-fetches a finished season whose pages were cached before it ended', async () => {
    await run(['--season', '2025'], { now: Date.parse('2025-12-01T00:00:00.000Z') });
    const r = await run(['--season', '2025']);
    expect(r.calls.slice(0, 4)).toEqual([...SQUIGGLE, SEASON]);
  });

  it('--force re-fetches cached pages', async () => {
    await run(['--season', '2025']);
    const r = await run(['--season', '2025', '--force']);
    expect(r.code).toBe(0);
    for (const url of [...SQUIGGLE, SEASON, ...FIXTURE_KEYS.map(matchUrl)]) {
      expect(r.calls).toContain(url);
    }
    expect(count(r.out, 'fetched')).toBe(4);
    expect(count(r.out, 'cached')).toBe(0);
  });

  it('stops on 5 consecutive failures, keeps what it fetched, and resumes on re-run', async () => {
    await run(['--season', '2025']);
    // Every match page not yet cached now fails with 503.
    const failing = fixturesByUrl();
    for (const { url } of parseSeasonPage(readAfltables('seas-2025.html'), 2025)) {
      if (!failing.has(url)) failing.set(url, 503);
    }
    const aborted = await run(['--season', '2025'], { routes: failing });
    expect(aborted.code).toBe(2);
    expect(aborted.out).toMatch(/aborted after 5 consecutive failed requests; re-run to resume/);
    expect(count(aborted.out, 'cached')).toBe(4);
    // The first page used 4 failed attempts, the second tripped the limit: every other link is
    // accounted for as not attempted.
    expect(count(aborted.out, 'failed')).toBe(1);
    expect(count(aborted.out, 'not attempted')).toBe(211);

    const resumed = await run(['--season', '2025']);
    expect(resumed.code).toBe(0);
    expect(count(resumed.out, 'cached')).toBe(4);
    expect(count(resumed.out, 'not yet published')).toBe(212);
  });

  it('--offline with an empty cache makes no request and exits 2', async () => {
    const r = await run(['--season', '2025', '--offline'], { env: {} });
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.err).toMatch(/not in the raw cache/i);
  });

  it('--offline after a run reports from the cache and needs no email', async () => {
    await run(['--season', '2025']);
    const r = await run(['--season', '2025', '--offline'], { env: {} });
    expect(r.calls).toEqual([]);
    expect(count(r.out, 'cached')).toBe(4);
    expect(count(r.out, 'failed')).toBe(212);
    expect(r.out).toMatch(/not cached \(offline\)/);
    expect(r.code).toBe(1);
  });

  it('--offline --force serves from the cache and reports it as cached, not fetched', async () => {
    await run(['--season', '2025']);
    const r = await run(['--season', '2025', '--offline', '--force'], { env: {} });
    expect(r.calls).toEqual([]);
    expect(count(r.out, 'fetched')).toBe(0);
    expect(count(r.out, 'cached')).toBe(4);
  });

  it('warns when a refresh fails and a stale cached copy is used', async () => {
    const midSeason = Date.parse('2025-12-01T00:00:00.000Z');
    await run(['--season', '2025'], { now: midSeason });
    const routes = fixturesByUrl();
    routes.set(SQUIGGLE[1] ?? '', 500);
    const r = await run(['--season', '2025'], { routes, now: midSeason });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /^warning: refresh failed, using the copy cached at 2025-12-01T00:00:00\.000Z: HTTP 500 for https:\/\/api\.squiggle\.com\.au\/\?q=games;year=2025/m,
    );
    expect(count(r.out, 'cached')).toBe(4);
  });

  it('refuses to run online without CONTACT_EMAIL, and makes no request', async () => {
    const r = await run(['--season', '2025'], { env: {} });
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(r.err).toMatch(/CONTACT_EMAIL/);
  });

  it('loads CONTACT_EMAIL from .env in the repo root when it exists', async () => {
    const before = process.env.CONTACT_EMAIL;
    delete process.env.CONTACT_EMAIL;
    try {
      await writeFile(join(root, '.env'), `CONTACT_EMAIL=${EMAIL}\n`);
      const r = await run(['--season', '2025'], { env: process.env });
      expect(r.code).toBe(0);
    } finally {
      if (before === undefined) delete process.env.CONTACT_EMAIL;
      else process.env.CONTACT_EMAIL = before;
    }
  });

  it('never prints the contact email', async () => {
    const r = await run(['--season', '2025']);
    const errors = await run(['--season', '2025', '--force'], {
      routes: new Map([[SQUIGGLE[0] ?? '', 500]]),
    });
    for (const text of [r.out, r.err, errors.out, errors.err]) expect(text).not.toContain(EMAIL);
    expect(errors.code).toBe(2);
  });

  it.each([
    [[]],
    [['--season']],
    [['--season', 'abc']],
    [['--season', '1800']],
    [['--season', '2002']],
    [['--season', '2025', '--bogus']],
  ])('rejects bad arguments %j with usage and exit 2', async (args) => {
    const r = await run(args);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/usage: npm run ingest -- --season <YYYY>/i);
    expect(r.calls).toEqual([]);
  });

  it('explains that seasons before 2003 arrive with the team lineage', async () => {
    const r = await run(['--season', '1995']);
    expect(r.err).toContain('--season must be a year from 2003 to 2100 (got 1995)');
    expect(r.err).toContain('M7');
  });
});

describe('ingest CLI joins against Squiggle', () => {
  const games = 'https://api.squiggle.com.au/?q=games;year=2025';
  const editedGames = (edit: (games: Record<string, unknown>[]) => void) => {
    const routes = fixturesByUrl();
    const body = JSON.parse(String(routes.get(games)));
    edit(body.games);
    routes.set(games, Buffer.from(JSON.stringify(body)));
    return routes;
  };

  it('fails a season-page match with no Squiggle game and continues', async () => {
    const routes = editedGames((g) => {
      const i = g.findIndex((x) => x.hteam === 'Richmond' && x.round === 9);
      g.splice(i, 1);
    });
    const r = await run(['--season', '2025'], { routes });
    expect(r.code).toBe(1);
    expect(count(r.out, 'failed')).toBe(1);
    expect(r.out).toMatch(/141820250511: no Squiggle game/);
    expect(count(r.out, 'fetched')).toBe(3);
  });

  it('never fetches a match Squiggle has not marked complete', async () => {
    const routes = editedGames((g) => {
      const game = g.find((x) => x.hteam === 'Richmond' && x.round === 9);
      if (game) game.complete = 75;
    });
    const r = await run(['--season', '2025'], { routes });
    expect(r.out).toContain('215 complete in Squiggle (1 not complete)');
    expect(r.out).toMatch(/^ {2}not complete +1 {3}141820250511$/m);
    expect(r.calls).not.toContain(matchUrl('141820250511'));
  });

  it('accepts a final whose teams are not decided yet, and never joins it', async () => {
    const routes = editedGames((g) => {
      const first = g[0];
      if (!first) return;
      g.push({
        ...first,
        id: 99998,
        round: 29,
        roundname: 'Grand Final',
        is_final: 6,
        is_grand_final: 1,
        hteamid: null,
        ateamid: null,
        hteam: null,
        ateam: null,
        hgoals: null,
        hbehinds: null,
        hscore: null,
        agoals: null,
        abehinds: null,
        ascore: null,
        winner: null,
        winnerteamid: null,
        complete: 0,
      });
    });
    const r = await run(['--season', '2025'], { routes });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('216 complete in Squiggle (1 not complete)');
    expect(count(r.out, 'not yet published')).toBe(212);
  });

  it('reports a complete Squiggle game with no AFL Tables link as not yet published', async () => {
    const routes = editedGames((g) => {
      const first = g[0];
      if (first) g.push({ ...first, id: 99999, localtime: '2025-12-01 19:40:00' });
    });
    const r = await run(['--season', '2025'], { routes });
    expect(count(r.out, 'not yet published')).toBe(213);
    expect(r.out).toContain('2025-12-01 sydney v hawthorn');
  });
});

describe('formatSummary', () => {
  it('lists up to 10 keys per line, then a count of the rest', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `1418202505${String(i).padStart(2, '0')}`);
    const summary: IngestSummary = {
      season: 2025,
      squiggleComplete: 12,
      squiggleNotComplete: 0,
      seasonPageLinks: 12,
      fetched: [],
      cached: [],
      notComplete: [],
      notYetPublished: keys,
      notAttempted: [],
      failed: [{ matchKey: '141820250511', reason: 'HTTP 403' }],
      warnings: ['refresh failed'],
      aborted: false,
    };
    const text = formatSummary(summary);
    expect(text).toContain(`not yet published   12   ${keys.slice(0, 10).join(', ')} … and 2 more`);
    expect(text).toContain('failed               1   141820250511: HTTP 403');
    expect(text).toContain('warning: refresh failed');
    expect(text).not.toContain('not attempted');
  });
});
