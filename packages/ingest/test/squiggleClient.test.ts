import { describe, expect, it } from 'vitest';
import { cacheKeyForUrl, type RawCache, type RawCacheEntry } from '../src/cache.ts';
import { createHttpClient } from '../src/http.ts';
import {
  fetchGames,
  fetchStandings,
  fetchTeams,
  SquiggleResponseError,
  squiggleUrl,
} from '../src/squiggle/client.ts';
import { fakeFetch, fixturesByUrl } from './helpers.ts';

class MemoryCache implements RawCache {
  readonly entries = new Map<string, RawCacheEntry>();
  async get(key: string) {
    return this.entries.get(key);
  }
  async has(key: string) {
    return this.entries.has(key);
  }
  async put(key: string, body: Buffer, meta: RawCacheEntry['meta']) {
    this.entries.set(key, { body, meta });
  }
}

function client(routes: Map<string, Buffer | number> = fixturesByUrl()) {
  const fake = fakeFetch(routes);
  const cache = new MemoryCache();
  const http = createHttpClient({
    cache,
    contactEmail: 'crawler@example.com',
    fetch: fake.fetch,
    sleep: async () => {},
  });
  return { http, cache, calls: fake.calls };
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('squiggleUrl', () => {
  it('builds the fixture URLs, whose cache keys are the sha1 of the query', () => {
    expect(squiggleUrl('teams')).toBe('https://api.squiggle.com.au/?q=teams');
    expect(squiggleUrl('games', 2025)).toBe('https://api.squiggle.com.au/?q=games;year=2025');
    expect(squiggleUrl('standings', 2025)).toBe(
      'https://api.squiggle.com.au/?q=standings;year=2025',
    );
    expect(cacheKeyForUrl(squiggleUrl('games', 2025))).toMatch(/^squiggle\/[0-9a-f]{40}\.json$/);
  });

  it('needs a year for games and standings, and none for teams', () => {
    expect(() => squiggleUrl('games')).toThrow(/year/);
    expect(() => squiggleUrl('teams', 2025)).toThrow(/year/);
  });
});

describe('fetchTeams / fetchGames / fetchStandings against the fixtures', () => {
  it('validates the 18 teams', async () => {
    const teams = await fetchTeams(client().http);
    expect(teams).toHaveLength(18);
    expect(teams[0]).toEqual({
      id: 1,
      name: 'Adelaide',
      abbrev: 'ADE',
      debut: 1991,
      retirement: 9999,
    });
  });

  it('validates the 216 games of 2025, keeping the fields the join needs', async () => {
    const games = await fetchGames(client().http, 2025);
    expect(games).toHaveLength(216);
    expect(games.every((g) => g.complete === 100)).toBe(true);
    const r23 = games.find((g) => g.hteam === 'Fremantle' && g.round === 23);
    expect(r23).toMatchObject({
      hteamid: 6,
      ateamid: 2,
      localtime: '2025-08-15 18:20:00',
      date: '2025-08-15 20:20:00',
      tz: '+10:00',
      unixtime: 1755253200,
      is_final: 0,
      is_grand_final: 0,
    });
    const gf = games.find((g) => g.is_grand_final === 1);
    expect(gf).toMatchObject({ round: 28, roundname: 'Grand Final', is_final: 6 });
    const draw = games.find((g) => g.hscore === g.ascore);
    expect(draw).toMatchObject({ winner: null, winnerteamid: null, hscore: 71 });
  });

  it('validates the 18 standings rows', async () => {
    const standings = await fetchStandings(client().http, 2025);
    expect(standings).toHaveLength(18);
    expect(standings[0]).toMatchObject({ id: 1, rank: 1, pts: 72, for: 2278, against: 1635 });
  });

  it('goes through the HTTP client: a second call is a cache hit with no request', async () => {
    const { http, calls } = client();
    await fetchGames(http, 2025);
    await fetchGames(http, 2025);
    expect(calls).toEqual(['https://api.squiggle.com.au/?q=games;year=2025']);
  });
});

describe('Squiggle response errors', () => {
  const games = 'https://api.squiggle.com.au/?q=games;year=2025';

  it('rejects a body that is not JSON', async () => {
    const { http } = client(new Map([[games, Buffer.from('<html>oops</html>')]]));
    await expect(fetchGames(http, 2025)).rejects.toThrow(SquiggleResponseError);
  });

  it('rejects a game missing a field, naming the query and the path', async () => {
    const { http } = client(new Map([[games, json({ games: [{ id: 1 }] })]]));
    await expect(fetchGames(http, 2025)).rejects.toThrow(/q=games;year=2025.*games\.0\./s);
  });

  it('rejects a game from another year', async () => {
    const body = JSON.parse(fixturesByUrl().get(games)?.toString() ?? '{}');
    body.games[0].year = 2024;
    const { http } = client(new Map([[games, json(body)]]));
    await expect(fetchGames(http, 2025)).rejects.toThrow(/year 2024/);
  });

  it('rejects a complete game without scores, but accepts an upcoming one', async () => {
    const body = JSON.parse(fixturesByUrl().get(games)?.toString() ?? '{}');
    const upcoming = { ...body.games[0], complete: 0, hscore: null, ascore: null, hgoals: null };
    const { http: ok } = client(new Map([[games, json({ games: [upcoming] })]]));
    await expect(fetchGames(ok, 2025)).resolves.toHaveLength(1);

    const broken = { ...upcoming, complete: 100 };
    const { http: bad } = client(new Map([[games, json({ games: [broken] })]]));
    await expect(fetchGames(bad, 2025)).rejects.toThrow(/complete game without scores/);
  });

  it('accepts a final whose teams are undecided, but not a started game without teams', async () => {
    const body = JSON.parse(fixturesByUrl().get(games)?.toString() ?? '{}');
    const undecided = {
      ...body.games[0],
      complete: 0,
      hteamid: null,
      ateamid: null,
      hteam: null,
      ateam: null,
      hscore: null,
      ascore: null,
    };
    const { http: ok } = client(new Map([[games, json({ games: [undecided] })]]));
    await expect(fetchGames(ok, 2025)).resolves.toMatchObject([{ hteamid: null }]);

    const started = { ...undecided, complete: 20 };
    const { http: bad } = client(new Map([[games, json({ games: [started] })]]));
    await expect(fetchGames(bad, 2025)).rejects.toThrow(/started game without teams/);
  });

  it('strips unknown upstream fields rather than failing', async () => {
    const body = JSON.parse(fixturesByUrl().get(games)?.toString() ?? '{}');
    body.games[0].newField = 'x';
    const { http } = client(new Map([[games, json(body)]]));
    const [first] = await fetchGames(http, 2025);
    expect(first).not.toHaveProperty('newField');
    expect(first).not.toHaveProperty('timestr');
  });
});
