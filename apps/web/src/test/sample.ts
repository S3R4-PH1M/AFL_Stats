import type {
  BoxScoreLine,
  LadderRow,
  MatchDetailFile,
  MatchSide,
  MatchSummary,
  MetaFile,
  QuarterScore,
  SeasonLadderFile,
  SeasonMatchesFile,
  StatValues,
} from '@afl/core';

/** Typed sample data shaped on the published fixture files (`packages/publish/test/golden`). */

const STAT_KEYS = [
  'ki',
  'mk',
  'hb',
  'di',
  'gl',
  'bh',
  'ho',
  'tk',
  'rb',
  'if50',
  'cl',
  'cg',
  'ff',
  'fa',
  'br',
  'cp',
  'up',
  'cm',
  'mi',
  'one_pct',
  'bo',
  'ga',
  'pct_played',
] as const satisfies readonly (keyof StatValues)[];

export function stats(patch: Partial<StatValues> = {}): StatValues {
  const base = Object.fromEntries(STAT_KEYS.map((k) => [k, 0])) as StatValues;
  return { ...base, pct_played: 80, ...patch };
}

export const meta: MetaFile = {
  version: 'v1',
  dataAsOf: '2026-10-14T00:00:00.000Z',
  seasons: [2003, 2025],
  teams: [
    { teamId: 'adelaide', name: 'Adelaide', abbrev: 'ADE' },
    { teamId: 'essendon', name: 'Essendon', abbrev: 'ESS' },
    { teamId: 'geelong', name: 'Geelong', abbrev: 'GEE' },
    { teamId: 'brisbane-lions', name: 'Brisbane Lions', abbrev: 'BRI' },
    { teamId: 'richmond', name: 'Richmond', abbrev: 'RIC' },
    { teamId: 'west-coast', name: 'West Coast', abbrev: 'WCE' },
  ],
  stats: [
    {
      code: 'KI',
      column: 'ki',
      label: 'Kicks',
      description: 'Kicks',
      firstSeason: 1998,
      higherIsBetter: true,
      displayOrder: 1,
    },
    {
      code: 'DI',
      column: 'di',
      label: 'Disposals',
      description: 'Kicks plus handballs',
      firstSeason: 1998,
      higherIsBetter: true,
      displayOrder: 4,
    },
    {
      code: 'GL',
      column: 'gl',
      label: 'Goals',
      description: 'Goals kicked',
      firstSeason: 1998,
      higherIsBetter: true,
      displayOrder: 5,
    },
    {
      code: 'BH',
      column: 'bh',
      label: 'Behinds',
      description: 'Behinds kicked',
      firstSeason: 1998,
      higherIsBetter: true,
      displayOrder: 6,
    },
    {
      code: 'GA',
      column: 'ga',
      label: 'Goal assists',
      description: 'Goal assists',
      firstSeason: 2003,
      higherIsBetter: true,
      displayOrder: 22,
    },
    {
      code: '%P',
      column: 'pct_played',
      label: '% played',
      description: 'Game time',
      firstSeason: 2003,
      higherIsBetter: true,
      displayOrder: 23,
    },
  ],
};

const row = (patch: Partial<LadderRow> & Pick<LadderRow, 'rank' | 'teamId'>): LadderRow => ({
  played: 1,
  wins: 0,
  losses: 0,
  draws: 0,
  pts: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  percentage: null,
  ...patch,
});

export const ladder: SeasonLadderFile = {
  season: 2025,
  rounds: [
    {
      roundNo: 0,
      roundLabel: 'Opening Round',
      rows: [
        row({
          rank: 1,
          teamId: 'adelaide',
          wins: 1,
          pts: 4,
          pointsFor: 161,
          pointsAgainst: 100,
          percentage: 161,
        }),
        row({
          rank: 2,
          teamId: 'essendon',
          losses: 1,
          pointsFor: 100,
          pointsAgainst: 161,
          percentage: 62.11,
        }),
        row({ rank: 3, teamId: 'richmond', played: 0 }),
      ],
    },
    {
      roundNo: 1,
      roundLabel: 'Round 1',
      rows: [
        row({
          rank: 1,
          teamId: 'richmond',
          wins: 1,
          pts: 4,
          pointsFor: 81,
          pointsAgainst: 79,
          percentage: 102.53,
        }),
        row({
          rank: 2,
          teamId: 'adelaide',
          wins: 1,
          pts: 4,
          pointsFor: 161,
          pointsAgainst: 100,
          percentage: 161,
        }),
        row({
          rank: 3,
          teamId: 'essendon',
          losses: 1,
          pointsFor: 100,
          pointsAgainst: 161,
          percentage: 62.11,
        }),
      ],
    },
  ],
};

const quarters = (cum: [number, number][]): QuarterScore[] =>
  cum.map(([g, b], i) => {
    const [pg, pb] = i === 0 ? [0, 0] : (cum[i - 1] as [number, number]);
    return {
      quarter: i + 1,
      goals: g - pg,
      behinds: b - pb,
      points: 6 * (g - pg) + (b - pb),
      cumGoals: g,
      cumBehinds: b,
      cumPoints: 6 * g + b,
    };
  });

const side = (teamId: string, cum: [number, number][]): MatchSide => {
  const [g, b] = cum.at(-1) as [number, number];
  return { teamId, goals: g, behinds: b, score: 6 * g + b, quarters: quarters(cum) };
};

const summary = (
  patch: Partial<MatchSummary> & Pick<MatchSummary, 'matchId' | 'home' | 'away'>,
): MatchSummary => ({
  squiggleId: null,
  season: 2025,
  roundNo: 1,
  roundLabel: 'Round 1',
  isFinal: false,
  isGrandFinal: false,
  startUtc: '2025-05-11T03:10:00.000Z',
  localTime: 'Sun, 11-May-2025 1:10 PM',
  venue: 'M.C.G.',
  attendance: 29539,
  ...patch,
});

export const richmondWestCoast = summary({
  matchId: '141820250511',
  home: side('richmond', [
    [3, 4],
    [6, 8],
    [8, 12],
    [11, 15],
  ]),
  away: side('west-coast', [
    [2, 3],
    [5, 6],
    [9, 10],
    [11, 13],
  ]),
});

export const matches: SeasonMatchesFile = {
  season: 2025,
  matches: [
    summary({
      matchId: '010520250322',
      roundNo: 0,
      roundLabel: 'Opening Round',
      home: side('essendon', [
        [4, 2],
        [8, 5],
        [12, 8],
        [15, 10],
      ]),
      away: side('adelaide', [
        [6, 3],
        [12, 6],
        [19, 9],
        [25, 11],
      ]),
    }),
    richmondWestCoast,
    summary({
      matchId: '091920250927',
      roundNo: null,
      roundLabel: 'Grand Final',
      isFinal: true,
      isGrandFinal: true,
      attendance: 100022,
      home: side('geelong', [
        [2, 3],
        [5, 6],
        [6, 8],
        [11, 9],
      ]),
      away: side('brisbane-lions', [
        [1, 6],
        [5, 6],
        [9, 9],
        [18, 14],
      ]),
    }),
  ],
};

const line = (
  playerId: string,
  displayName: string,
  jumper: number | null,
  patch: Partial<StatValues> = {},
): BoxScoreLine => ({
  playerId,
  displayName,
  jumper,
  subStatus: null,
  stats: stats(patch),
});

export const matchDetail: MatchDetailFile = {
  ...richmondWestCoast,
  home: {
    ...richmondWestCoast.home,
    quarters: [
      ...richmondWestCoast.home.quarters,
      { quarter: 5, goals: 1, behinds: 0, points: 6, cumGoals: 12, cumBehinds: 15, cumPoints: 87 },
    ],
    players: [
      line('T/Tom_Lynch1', 'Tom Lynch', 19, { ki: 10, di: 14, gl: 3, bh: 2, ga: null }),
      { ...line('A/Sub_Player', 'Sub Player', 27, { ki: 2, di: 3, ga: null }), subStatus: 'on' },
    ],
    totals: stats({ ki: 12, di: 17, gl: 3, bh: 6, ga: null, pct_played: null }),
    rushedBehinds: 4,
  },
  away: {
    ...richmondWestCoast.away,
    players: [line('J/Jack_Darling', 'Jack Darling', 27, { ki: 8, di: 11, gl: 2, ga: null })],
    totals: stats({ ki: 8, di: 11, gl: 2, bh: 2, ga: null, pct_played: null }),
    rushedBehinds: 2,
  },
};
