import { STAT_COLUMNS } from '@afl/core';
import { decodeHtml, type ParsedMatchPage, parseMatchPage } from '@afl/ingest';
import { describe, expect, it } from 'vitest';
import { applyBrownlowRule, COLUMNS, LoadBatch } from '../src/load.ts';
import { readFixture } from './fixtureCache.ts';

function page(name: string): ParsedMatchPage {
  const [season, matchKey] = name.split('-') as [string, string];
  return parseMatchPage(decodeHtml(readFixture(`afltables/${name}.html`)), {
    season: Number(season),
    matchKey,
  });
}

/** The page as it looks before the Brownlow count: every BR cell blank, so 0. */
function beforeTheCount(p: ParsedMatchPage): ParsedMatchPage {
  return {
    ...p,
    players: p.players.map((x) => ({ ...x, br: 0 })),
    teamTotals: p.teamTotals.map((t) => ({ ...t, stats: { ...t.stats, br: 0 } })) as [
      (typeof p.teamTotals)[0],
      (typeof p.teamTotals)[1],
    ],
  };
}

describe('applyBrownlowRule (decision D-b)', () => {
  it('keeps the votes of a counted home-and-away match (6 votes)', () => {
    const p = page('2025-141820250511');
    const { players, warning } = applyBrownlowRule(p);
    expect(players).toBe(p.players);
    expect(players.reduce((s, x) => s + (x.br ?? 0), 0)).toBe(6);
    expect(warning).toBeUndefined();
  });

  it('loads BR as NULL, with a warning, for a home-and-away match cached before the count', () => {
    const p = beforeTheCount(page('2025-141820250511'));
    const { players, teamTotals, warning } = applyBrownlowRule(p);
    expect(players.every((x) => x.br === null)).toBe(true);
    expect(teamTotals.every((t) => t.stats.br === null)).toBe(true);
    expect(players.map((x) => x.gl)).toEqual(p.players.map((x) => x.gl));
    expect(warning).toBe(
      '141820250511: Brownlow votes not yet published (BR loaded as NULL); after the count run npm run ingest -- --season 2025 --force',
    );
  });

  it('leaves a final alone: finals have no votes', () => {
    const p = page('2025-091920250927');
    const { players, warning } = applyBrownlowRule(p);
    expect(players.every((x) => x.br === 0)).toBe(true);
    expect(warning).toBeUndefined();
  });
});

describe('LoadBatch', () => {
  it('seeds 18 teams and 23 stat definitions, with every AFL Tables name', () => {
    const batch = new LoadBatch();
    batch.seed();
    expect(batch.rows.team).toHaveLength(18);
    expect(batch.rows.stat_definition).toHaveLength(23);
    const north = batch.rows.team.find((r) => r[0] === 'north-melbourne');
    expect(String(north?.[4])).toBe("['North Melbourne', 'Kangaroos']");
    expect(batch.rows.stat_definition.map((r) => r[1])).toEqual([...STAT_COLUMNS]);
  });

  it('builds rows that match the column lists', () => {
    const batch = new LoadBatch();
    batch.seed();
    batch.addMatch(page('2025-141820250511'), undefined, '2026-10-14T00:00:00.000Z');
    for (const [table, rows] of Object.entries(batch.rows)) {
      const width = COLUMNS[table as keyof typeof COLUMNS].length;
      for (const row of rows) expect(row).toHaveLength(width);
    }
    expect(batch.rows.match[0]).toEqual([
      '141820250511',
      null,
      2025,
      'Round 10',
      10,
      false,
      false,
      '2025-05-11T03:10:00.000Z',
      '2025-05-11',
      'Sun, 11-May-2025 1:10 PM',
      'M.C.G.',
      29539,
      'richmond',
      'west-coast',
      81,
      79,
      '2026-10-14T00:00:00.000Z',
    ]);
  });

  it('keeps one player row per player, warning when a later page names them differently', () => {
    const draw = page('2025-121920250511');
    const gf = page('2025-091920250927');
    const shared = draw.people.find((d) => gf.people.some((g) => g.player_id === d.player_id));
    if (!shared) throw new Error('no player in both fixtures');
    const renamed: ParsedMatchPage = {
      ...gf,
      people: gf.people.map((p) =>
        p.player_id === shared.player_id ? { ...p, display_name: 'Someone Else' } : p,
      ),
    };

    const batch = new LoadBatch();
    batch.addMatch(draw, undefined, '2026-10-14T00:00:00.000Z');
    batch.addMatch(renamed, undefined, '2026-10-14T00:00:00.000Z');
    const ids = batch.rows.player.map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(batch.rows.player.find((r) => r[0] === shared.player_id)?.[3]).toBe(shared.display_name);
    expect(batch.warnings).toContain(
      `091920250927: ${shared.player_id} is "Someone Else", but "${shared.display_name}" in 121920250511; keeping the first`,
    );
  });
});
