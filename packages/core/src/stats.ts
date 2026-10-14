/**
 * The 23 per-player match stats (proposal §6.2, §6.3, §7; task 9.1).
 * Seeds the `stat_definition` table; SQL models are generated from it.
 */
export interface StatDefinition {
  /** AFL Tables column heading. */
  readonly code: string;
  /** Column name in `player_match` (§7). */
  readonly column: StatColumn;
  readonly label: string;
  readonly description: string;
  /**
   * First season AFL Tables records the stat. Inside coverage a blank cell means 0,
   * before it means NULL (§6.4.1).
   */
  readonly firstSeason: number;
  readonly higherIsBetter: boolean;
  readonly displayOrder: number;
}

/** `player_match` stat columns, in AFL Tables column order. */
export const STAT_COLUMNS = [
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
] as const;

export type StatColumn = (typeof STAT_COLUMNS)[number];

// Pre-2003 first seasons are to confirm (M7): §6.3 only shows the core stats populated by 1998,
// and CP UP CM MI 1% BO starting somewhere in 1999–2002. Everything in scope for M1–M6 is 2003+.
const CORE = 1998; // to confirm (M7)
const EXTENDED = 2002; // to confirm (M7)
const FULL = 2003;

type Row = [code: string, column: StatColumn, label: string, description: string, first: number];

const ROWS: readonly Row[] = [
  ['KI', 'ki', 'Kicks', 'Kicks', CORE],
  ['MK', 'mk', 'Marks', 'Marks', CORE],
  ['HB', 'hb', 'Handballs', 'Handballs', CORE],
  ['DI', 'di', 'Disposals', 'Kicks plus handballs', CORE],
  ['GL', 'gl', 'Goals', 'Goals kicked', CORE],
  ['BH', 'bh', 'Behinds', 'Behinds kicked (excludes rushed behinds)', CORE],
  ['HO', 'ho', 'Hit-outs', 'Ruck hit-outs', CORE],
  ['TK', 'tk', 'Tackles', 'Tackles', CORE],
  ['RB', 'rb', 'Rebound 50s', 'Rebounds out of the defensive 50', CORE],
  ['IF', 'if50', 'Inside 50s', 'Entries into the forward 50', CORE],
  ['CL', 'cl', 'Clearances', 'Clearances from stoppages', CORE],
  ['CG', 'cg', 'Clangers', 'Errors: turnovers, free kicks against and similar', CORE],
  ['FF', 'ff', 'Free kicks for', 'Free kicks awarded to the player', CORE],
  ['FA', 'fa', 'Free kicks against', 'Free kicks paid against the player', CORE],
  ['BR', 'br', 'Brownlow votes', 'Brownlow Medal votes', CORE],
  ['CP', 'cp', 'Contested possessions', 'Possessions won in contest', EXTENDED],
  ['UP', 'up', 'Uncontested possessions', 'Possessions won without contest', EXTENDED],
  ['CM', 'cm', 'Contested marks', 'Marks taken in contest', EXTENDED],
  ['MI', 'mi', 'Marks inside 50', 'Marks taken inside the forward 50', EXTENDED],
  ['1%', 'one_pct', 'One percenters', 'Spoils, smothers, shepherds and similar', EXTENDED],
  ['BO', 'bo', 'Bounces', 'Bounces while running with the ball', EXTENDED],
  ['GA', 'ga', 'Goal assists', 'Disposals leading directly to a goal', FULL],
  ['%P', 'pct_played', '% played', 'Percentage of game time on the ground', FULL],
];

/** Stats where a lower value is better. */
const LOWER_IS_BETTER = new Set<StatColumn>(['cg', 'fa']);

export const STAT_DEFINITIONS: readonly StatDefinition[] = ROWS.map(
  ([code, column, label, description, firstSeason], i) => ({
    code,
    column,
    label,
    description,
    firstSeason,
    higherIsBetter: !LOWER_IS_BETTER.has(column),
    displayOrder: i + 1,
  }),
);
