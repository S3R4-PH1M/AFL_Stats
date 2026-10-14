import { STAT_COLUMNS, STAT_DEFINITIONS, type StatColumn, type StatDefinition } from '@afl/core';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  MatchPageError,
  type ParsedMatchPage,
  parseMatchPage,
  statValue,
} from '../src/afltables/matchPage.ts';
import { MATCH_FIXTURES, readAfltables } from './helpers.ts';

function parseFixture(name: string, overrides: { season?: number; matchKey?: string } = {}) {
  const fixture = MATCH_FIXTURES.find((f) => f.name === name);
  if (!fixture) throw new Error(`no fixture ${name}`);
  return parseMatchPage(readAfltables(`${name}.html`), { ...fixture, ...overrides });
}

const COUNT_COLUMNS = STAT_COLUMNS.filter((c) => c !== 'pct_played');

describe.each(MATCH_FIXTURES)('parseMatchPage($name)', ({ name, season }) => {
  const result = parseFixture(name);
  const perTeam = season === 2003 ? 22 : 23;

  it('matches the golden file', async () => {
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(
      `./golden/${name}.json`,
    );
  });

  it(`has ${perTeam} linked players per team with unique ids`, () => {
    const { home_team_id, away_team_id } = result.match;
    for (const team of [home_team_id, away_team_id]) {
      expect(result.players.filter((p) => p.team_id === team)).toHaveLength(perTeam);
    }
    const ids = result.players.map((p) => p.player_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]\/[^/"]+$/);
    expect(result.people.map((p) => p.player_id)).toEqual(ids);
  });

  it('marks substitutes from the # cell: one on and one off per team in 2025, none in 2003', () => {
    const marked = result.players.filter((p) => p.sub_status !== null);
    if (season === 2003) {
      expect(marked).toEqual([]);
      return;
    }
    expect(marked).toHaveLength(4);
    for (const team of [result.match.home_team_id, result.match.away_team_id]) {
      const subs = marked.filter((p) => p.team_id === team).map((p) => p.sub_status);
      expect(subs.sort()).toEqual(['off', 'on']);
    }
    for (const p of result.players) expect(Number.isInteger(p.jumper)).toBe(true);
  });

  it('reconciles players with the header score and the Totals row', () => {
    for (const [i, totals] of result.teamTotals.entries()) {
      const team = totals.team_id;
      const players = result.players.filter((p) => p.team_id === team);
      const last = result.quarters.filter((q) => q.team_id === team).at(-1);
      const sum = (col: StatColumn) => players.reduce((t, p) => t + (p[col] ?? 0), 0);
      expect(team).toBe(i === 0 ? result.match.home_team_id : result.match.away_team_id);
      expect(last?.cum_points).toBe(i === 0 ? result.match.home_score : result.match.away_score);
      expect(sum('gl')).toBe(last?.cum_goals);
      expect(sum('bh')).toBeLessThanOrEqual(last?.cum_behinds ?? -1);
      expect(sum('bh') + totals.rushed_behinds).toBe(last?.cum_behinds);
      for (const col of COUNT_COLUMNS) {
        const expected = col === 'bh' ? sum('bh') + totals.rushed_behinds : sum(col);
        expect([col, totals.stats[col]]).toEqual([col, expected]);
      }
      expect(totals.stats.pct_played).toBeNull();
    }
  });

  it('has no NULL stats (2003+ is inside every stat’s coverage) and no warnings', () => {
    for (const p of result.players) {
      for (const col of STAT_COLUMNS) expect(p[col]).not.toBeNull();
    }
    expect(result.warnings).toEqual([]);
  });
});

/** Values copied from the pages by eye. */
describe('values from the pages', () => {
  const player = (r: ParsedMatchPage, id: string) => r.players.find((p) => p.player_id === id);

  it('2025-010520250322: R3 (AFL R2), Essendon v Adelaide', () => {
    const r = parseFixture('2025-010520250322');
    expect(r.match).toEqual({
      match_id: '010520250322',
      squiggle_id: null,
      season: 2025,
      round_label: 'Round 3',
      round_no: 3,
      is_final: false,
      is_grand_final: false,
      start_utc: '2025-03-22T02:20:00.000Z',
      local_time: 'Sat, 22-Mar-2025 1:20 PM',
      venue: 'M.C.G.',
      attendance: 46688,
      home_team_id: 'essendon',
      away_team_id: 'adelaide',
      home_score: 100,
      away_score: 161,
    });
    expect(player(r, 'N/Nick_Bryan')).toEqual({
      match_id: '010520250322',
      player_id: 'N/Nick_Bryan',
      team_id: 'essendon',
      jumper: 24,
      sub_status: null,
      ki: 12,
      mk: 1,
      hb: 2,
      di: 14,
      gl: 0,
      bh: 1,
      ho: 23,
      tk: 2,
      rb: 1,
      if50: 3,
      cl: 5,
      cg: 1,
      ff: 0,
      fa: 1,
      br: 0,
      cp: 8,
      up: 5,
      cm: 0,
      mi: 0,
      one_pct: 1,
      bo: 0,
      ga: 0,
      pct_played: 70,
    });
    expect(r.people.find((p) => p.player_id === 'N/Nick_Bryan')).toEqual({
      player_id: 'N/Nick_Bryan',
      display_name: 'Nick Bryan',
      first_name: 'Nick',
      surname: 'Bryan',
    });
    expect(player(r, 'N/Nate_Caddy')).toMatchObject({ jumper: 30, sub_status: 'off' });
    expect(r.teamTotals[0]).toEqual({
      team_id: 'essendon',
      rushed_behinds: 1,
      stats: {
        ki: 179,
        mk: 59,
        hb: 172,
        di: 351,
        gl: 15,
        bh: 10,
        ho: 38,
        tk: 48,
        rb: 37,
        if50: 48,
        cl: 39,
        cg: 62,
        ff: 21,
        fa: 17,
        br: 1,
        cp: 126,
        up: 217,
        cm: 7,
        mi: 7,
        one_pct: 32,
        bo: 13,
        ga: 12,
        pct_played: null,
      },
    });
    expect(player(r, 'A/Alex_Neal-Bullen')?.team_id).toBe('adelaide');
    expect(r.quarters.filter((q) => q.team_id === 'essendon').map((q) => q.cum_points)).toEqual([
      20, 34, 61, 100,
    ]);
  });

  it('2025-141820250511: R10 (AFL R9), Richmond v West Coast', () => {
    const r = parseFixture('2025-141820250511');
    expect(r.match).toMatchObject({
      round_label: 'Round 10',
      home_team_id: 'richmond',
      away_team_id: 'west-coast',
      home_score: 81,
      away_score: 79,
      attendance: 29539,
      start_utc: '2025-05-11T03:10:00.000Z',
    });
    const ids = r.players.map((p) => p.player_id);
    for (const id of [
      'B/Bailey_Williams1',
      'J/Jack_Graham2',
      'J/Jack_Ross3',
      'L/Luke_Trainor1',
      'T/Tom_Lynch1',
    ]) {
      expect(ids).toContain(id);
    }
    expect(player(r, 'T/Thomson_Dow')).toMatchObject({ jumper: 27, sub_status: 'off' });
  });

  it('2025-091920250927: Grand Final, Geelong v Brisbane Lions', () => {
    const r = parseFixture('2025-091920250927');
    expect(r.match).toMatchObject({
      round_label: 'Grand Final',
      round_no: null,
      is_final: true,
      is_grand_final: true,
      home_team_id: 'geelong',
      away_team_id: 'brisbane-lions',
      home_score: 75,
      away_score: 122,
      attendance: 100022,
    });
    expect(r.teamTotals.map((t) => t.rushed_behinds)).toEqual([3, 0]);
  });

  it('2025-121920250511: the draw, North Melbourne v Brisbane Lions at Bellerive', () => {
    const r = parseFixture('2025-121920250511');
    expect(r.match).toMatchObject({
      round_label: 'Round 10',
      venue: 'Bellerive Oval',
      home_score: 71,
      away_score: 71,
      attendance: 7395,
    });
    expect(player(r, 'L/Luke_Davies-Uniacke')?.team_id).toBe('north-melbourne');
  });

  it('2003-010320030629: Carlton v Adelaide', () => {
    const r = parseFixture('2003-010320030629');
    expect(r.match).toMatchObject({
      round_label: 'Round 13',
      round_no: 13,
      venue: 'Princes Park',
      home_team_id: 'carlton',
      away_team_id: 'adelaide',
      home_score: 50,
      away_score: 92,
      attendance: 19242,
      local_time: 'Sun, 29-Jun-2003 2:10 PM',
      start_utc: '2003-06-29T04:10:00.000Z',
    });
  });

  it('takes home and away from the header, not the ascending match-key codes', () => {
    // Key 0105 lists Adelaide (01) first, but Essendon (05) is the home side.
    const r = parseFixture('2025-010520250322');
    expect([r.match.home_team_id, r.match.away_team_id]).toEqual(['essendon', 'adelaide']);
    expect(r.quarters[0]?.team_id).toBe('essendon');
    expect(r.players[0]?.team_id).toBe('essendon');
  });
});

describe('parseMatchPage robustness (in-memory edits; fixtures are never changed)', () => {
  const name = '2025-010520250322';
  const html = readAfltables(`${name}.html`);
  const opts = { season: 2025, matchKey: '010520250322' };
  const statTables = ($: ReturnType<typeof load>) =>
    $('table').filter((_, t) => $(t).find('thead tr').first().text().includes('Match Statistics'));

  it('maps columns by header text: swapped columns and an unknown column change nothing', () => {
    const $ = load(html);
    const swap = (a: ReturnType<typeof $>, b: ReturnType<typeof $>) => {
      const marker = $('<td></td>');
      a.before(marker);
      b.before(a);
      marker.replaceWith(b);
    };
    statTables($).each((_, table) => {
      // KI and %P sit at grid positions 2 and 24; Totals and Opposition start with colspan=2.
      const rows = [$(table).find('thead tr').last(), ...$(table).find('tbody tr').toArray()];
      for (const row of rows) {
        const cells = $(row).children();
        swap(cells.eq(2), cells.eq(24));
      }
      $(table)
        .find('tfoot tr')
        .each((__, row) => {
          const cells = $(row).children();
          if (cells.first().attr('colspan') === '2') swap(cells.eq(1), cells.eq(23));
        });
      $(table).find('thead tr').last().append('<th>ZZ</th>');
      $(table).find('tbody tr').append('<td>9</td>');
    });
    expect($(statTables($).get(0)).find('thead tr').last().children().eq(2).text()).toBe('%P');

    const original = parseMatchPage(html, opts);
    const edited = parseMatchPage($.html(), opts);
    expect(edited.warnings).toEqual([
      'Essendon: unknown column "ZZ"',
      'Adelaide: unknown column "ZZ"',
    ]);
    expect({ ...edited, warnings: [] }).toEqual(original);
  });

  it('warns and stores NULL when a stat column is missing', () => {
    const $ = load(html);
    statTables($).each((_, table) => {
      $(table).find('thead tr').last().children().eq(23).text('XX'); // GA
    });
    const r = parseMatchPage($.html(), opts);
    expect(r.warnings).toContain('Essendon: missing column "GA"');
    expect(r.players.every((p) => p.ga === null)).toBe(true);
  });

  it('throws without the Match Statistics tables', () => {
    expect(() => parseMatchPage(html.replaceAll('Match Statistics', 'Match Stats'), opts)).toThrow(
      MatchPageError,
    );
  });

  it('throws when the match key or season does not match the page', () => {
    expect(() => parseMatchPage(html, { season: 2025, matchKey: '010520250323' })).toThrow(
      /does not match the match key/,
    );
    expect(() => parseMatchPage(html, { season: 2024, matchKey: '010520250322' })).toThrow(
      MatchPageError,
    );
  });

  it('throws when the player goals do not reconcile with the score', () => {
    const $ = load(html);
    // Nick Bryan's blank GL cell (grid position 6) becomes 1.
    $('a[href$="players/N/Nick_Bryan.html"]').first().closest('tr').children().eq(6).text('1');
    expect(() => parseMatchPage($.html(), opts)).toThrow(/Σ GL 16 ≠ team goals 15/);
  });

  it('throws on a player row without a player link', () => {
    const $ = load(html);
    const link = $('a[href$="players/N/Nick_Bryan.html"]').first();
    link.replaceWith(link.text());
    expect(() => parseMatchPage($.html(), opts)).toThrow(/player row without a link/);
  });
});

describe('statValue', () => {
  const def = (code: string) => STAT_DEFINITIONS.find((d) => d.code === code) as StatDefinition;

  it('reads a blank as 0 inside coverage and NULL before it (§6.4.1)', () => {
    expect(statValue(' ', def('GA'), 2003)).toBe(0);
    expect(statValue(' ', def('GA'), 2002)).toBeNull();
    expect(statValue('', def('KI'), 1998)).toBe(0);
    expect(statValue(' 12 ', def('KI'), 2025)).toBe(12);
    expect(statValue('87.5', def('%P'), 2025)).toBe(87.5);
  });

  it('rejects non-numeric cells and fractional counts', () => {
    expect(() => statValue('x', def('KI'), 2025)).toThrow();
    expect(() => statValue('1.5', def('KI'), 2025)).toThrow();
  });
});
