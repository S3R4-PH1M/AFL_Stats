import { closeDb, type Db } from '@afl/warehouse';
import { afterEach, describe, expect, it } from 'vitest';
import { queryMatchDetails, querySeasonLadder, querySeasonMatches } from '../src/queries.ts';
import { type SyntheticMatch, syntheticDb } from './synthetic.ts';

let db: Db | undefined;
afterEach(() => {
  if (db) closeDb(db);
  db = undefined;
});

const match = (
  patch: Partial<SyntheticMatch> & Pick<SyntheticMatch, 'matchId'>,
): SyntheticMatch => ({
  roundNo: 1,
  roundLabel: 'Round 1',
  home: 'richmond',
  away: 'carlton',
  homeGB: [10, 10],
  awayGB: [8, 8],
  ...patch,
});

// Opening Round 2025 had 2 Squiggle games (decision D-a); round 1 then has the rest, and the
// Opening Round teams have a bye in round 1.
const openingSeason: SyntheticMatch[] = [
  match({
    matchId: '010220250306',
    roundNo: 0,
    roundLabel: 'Opening Round',
    home: 'sydney',
    away: 'hawthorn',
  }),
  match({
    matchId: '030420250307',
    roundNo: 0,
    roundLabel: 'Opening Round',
    home: 'gws',
    away: 'collingwood',
  }),
  match({ matchId: '050620250313', home: 'richmond', away: 'carlton' }),
  match({
    matchId: '070820250315',
    home: 'essendon',
    away: 'adelaide',
    homeGB: [9, 9],
    awayGB: [9, 9],
  }),
];

describe('ladder edge cases (synthetic warehouse)', () => {
  it('labels round 0 "Opening Round" and ranks teams yet to play last with null percentage', async () => {
    db = await syntheticDb(openingSeason);
    const ladder = await querySeasonLadder(db.conn, 2025);
    expect(ladder.rounds.map((r) => [r.roundNo, r.roundLabel])).toEqual([
      [0, 'Opening Round'],
      [1, 'Round 1'],
    ]);
    const opening = ladder.rounds[0]?.rows ?? [];
    expect(opening).toHaveLength(8);
    expect(opening.slice(0, 2).map((r) => r.pts)).toEqual([4, 4]);
    expect(opening.slice(4).every((r) => r.played === 0 && r.percentage === null)).toBe(true);
  });

  it('carries a team on a bye with its running totals', async () => {
    db = await syntheticDb(openingSeason);
    const round1 = (await querySeasonLadder(db.conn, 2025)).rounds[1]?.rows ?? [];
    const sydney = round1.find((r) => r.teamId === 'sydney');
    expect(sydney).toMatchObject({ played: 1, wins: 1, pts: 4, pointsFor: 70, pointsAgainst: 56 });
    const draw = round1.filter((r) => r.draws === 1).map((r) => r.pts);
    expect(draw).toEqual([2, 2]);
  });

  it('fails when one round has two labels', async () => {
    db = await syntheticDb([
      match({ matchId: '010220250306' }),
      match({ matchId: '030420250307', roundLabel: 'Round One', home: 'sydney', away: 'hawthorn' }),
    ]);
    await expect(querySeasonLadder(db.conn, 2025)).rejects.toThrow(
      /2025 round 1 has more than one label: Round 1, Round One/,
    );
  });
});

describe('match edge cases (synthetic warehouse)', () => {
  it('publishes extra-time quarters and a null attendance and start time', async () => {
    db = await syntheticDb([
      match({
        matchId: '010220250906',
        roundNo: null,
        roundLabel: 'Semi Final',
        quarters: 5,
        homeGB: [10, 10],
        awayGB: [11, 4],
        attendance: null,
        startUtc: null,
      }),
    ]);
    const [m] = (await querySeasonMatches(db.conn, 2025)).matches;
    expect(m).toMatchObject({ isFinal: true, roundNo: null, attendance: null, startUtc: null });
    expect(m?.home.quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4, 5]);
    expect(m?.home).toMatchObject({ goals: 11, behinds: 10, score: 76 });
    expect(m?.away).toMatchObject({ goals: 11, behinds: 4, score: 70 });
    const [detail] = await queryMatchDetails(db.conn, 2025);
    expect(detail?.home.quarters).toHaveLength(5);
    expect(detail?.home.players.map((p) => p.displayName)).toEqual(['Player richmond']);
  });
});
