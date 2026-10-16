import { STAT_COLUMNS } from '@afl/core';
import { applySchema, type Db, LoadBatch, openDb, runModels } from '@afl/warehouse';

/** A hand-made match for cases the fixtures don't cover (Opening Round, byes, extra time). */
export interface SyntheticMatch {
  matchId: string;
  roundNo: number | null;
  roundLabel: string;
  home: string;
  away: string;
  /** Final [goals, behinds] per side. */
  homeGB: [number, number];
  awayGB: [number, number];
  /** 4, or 5+ with extra time. All scoring is in Q1 except one ET goal to the home side. */
  quarters?: number;
  attendance?: number | null;
  startUtc?: string | null;
}

const zeroStats = STAT_COLUMNS.map((c) => (c === 'pct_played' ? null : 0));

/** An in-memory warehouse holding only `matches`, with the models run over them. */
export async function syntheticDb(matches: readonly SyntheticMatch[]): Promise<Db> {
  const db = await openDb(':memory:');
  await applySchema(db.conn);
  const batch = new LoadBatch();
  batch.seed();
  const players = new Set<string>();
  for (const m of matches) {
    const quarters = m.quarters ?? 4;
    const et = quarters > 4;
    const sides = [
      [m.home, m.homeGB, true],
      [m.away, m.awayGB, false],
    ] as const;
    const score = ([g, b]: readonly [number, number], bonus: number) => 6 * (g + bonus) + b;
    const date = `${m.matchId.slice(4, 8)}-${m.matchId.slice(8, 10)}-${m.matchId.slice(10, 12)}`;
    batch.rows.match.push([
      m.matchId,
      null,
      Number(m.matchId.slice(4, 8)),
      m.roundLabel,
      m.roundNo,
      m.roundNo === null,
      false,
      m.startUtc === undefined ? `${date}T03:00:00Z` : m.startUtc,
      date,
      'Sat, 1:00 PM',
      'M.C.G.',
      m.attendance === undefined ? 30000 : m.attendance,
      m.home,
      m.away,
      score(m.homeGB, et ? 1 : 0),
      score(m.awayGB, 0),
      '2026-10-14T00:00:00Z',
    ]);
    for (const [team, [g, b], isHome] of sides) {
      for (let q = 1; q <= quarters; q += 1) {
        const qg = q === 1 ? g : q === 5 && isHome ? 1 : 0;
        const qb = q === 1 ? b : 0;
        const cumG = g + (q >= 5 && isHome ? 1 : 0);
        batch.rows.match_quarter.push([
          m.matchId,
          team,
          q,
          qg,
          qb,
          6 * qg + qb,
          cumG,
          b,
          6 * cumG + b,
        ]);
      }
      const playerId = `Z/${team}`;
      if (!players.has(playerId)) {
        players.add(playerId);
        batch.rows.player.push([playerId, null, null, `Player ${team}`]);
      }
      batch.rows.player_match.push([m.matchId, playerId, team, 1, null, ...zeroStats]);
      batch.rows.team_match_totals.push([m.matchId, team, 0, ...zeroStats]);
    }
  }
  await batch.insert(db.conn);
  await runModels(db.conn);
  return db;
}
