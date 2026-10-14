/**
 * AFL Tables match page → match, quarter, player and team-total rows (proposal §6.2, §6.4, task 9.4).
 *
 * - Tables are found by heading text and columns are mapped by header text (§6.4.8). Header
 *   positions honour `colspan`, because the footer rows ("Rushed", "Totals") span columns.
 * - Home and away come from the page header, never the match key (§6.4.5).
 * - Substitutes are the ↑ (on) / ↓ (off) marker in the `#` cell; there is no SU column (§6.2).
 * - A blank cell is 0 inside the stat's coverage and NULL before it (§6.4.1).
 *
 * Pure: no network or cache. `source_fetched_at` and `squiggle_id` are added when loading (M1d).
 */
import {
  MatchId,
  MatchRow,
  PlayerMatchRow,
  PlayerRow,
  QuarterRow,
  STAT_COLUMNS,
  STAT_DEFINITIONS,
  type StatColumn,
  type StatDefinition,
  StatValues,
  teamByAfltablesName,
  venueByAfltablesName,
} from '@afl/core';
import { type Cheerio, type CheerioAPI, load } from 'cheerio';
import { cleanText } from './decode.ts';
import { parseQuarterScores, type QuarterScoreParsed } from './parseScore.ts';
import { normaliseRound } from './rounds.ts';
import { parsePageDateTime } from './time.ts';

/** MatchRow before loading: `source_fetched_at` comes from the raw cache in M1d. */
export const ParsedMatchRow = MatchRow.omit({ source_fetched_at: true });
export type ParsedMatchRow = Omit<MatchRow, 'source_fetched_at'>;

export interface TeamTotals {
  team_id: string;
  /** Behinds not credited to any player ("Rushed" footer row; 0 when absent). */
  rushed_behinds: number;
  /** The "Totals" footer row. `pct_played` is NULL (blank on the page). */
  stats: StatValues;
}

export interface ParsedMatchPage {
  match: ParsedMatchRow;
  /** Home quarters, then away. */
  quarters: QuarterRow[];
  /** Home players, then away, in page order. */
  players: PlayerMatchRow[];
  /** One per entry in `players`, same order. */
  people: PlayerRow[];
  /** Home, then away. */
  teamTotals: [TeamTotals, TeamTotals];
  warnings: string[];
}

export interface MatchPageOptions {
  season: number;
  matchKey: string;
}

export class MatchPageError extends Error {
  constructor(matchKey: string, message: string) {
    super(`Match page ${matchKey}: ${message}`);
    this.name = 'MatchPageError';
  }
}

const STAT_BY_CODE = new Map(STAT_DEFINITIONS.map((d) => [d.code, d] as const));
const REQUIRED_HEADERS = ['#', 'Player', 'GL', 'BH'];
const PLAYERS_PER_TEAM = { min: 22, max: 23 };
const HEADER = /^Round: (.+?) Venue: (.+?) Date: (.+?) Attendance:(?: ([\d,]+))?$/;
const PLAYER_HREF = /players\/([A-Z]\/[^/"]+)\.html$/;
const JUMPER = /^(\d+)?\s*([↑↓])?$/;

/**
 * One stat cell → value. Blank means 0 when `season` is inside the stat's coverage, else NULL.
 */
export function statValue(cell: string, def: StatDefinition, season: number): number | null {
  const text = cleanText(cell);
  if (text === '') return season >= def.firstSeason ? 0 : null;
  const pattern = def.column === 'pct_played' ? /^\d+(?:\.\d+)?$/ : /^\d+$/;
  if (!pattern.test(text)) throw new Error(`${def.code} value "${text}" is not a number`);
  return Number(text);
}

export function parseMatchPage(html: string, opts: MatchPageOptions): ParsedMatchPage {
  const { season, matchKey } = opts;
  // Explicitly typed so TypeScript narrows after a call.
  const fail: Fail = (message) => {
    throw new MatchPageError(matchKey, message);
  };
  if (!MatchId.safeParse(matchKey).success) fail('invalid match key');
  if (Number(matchKey.slice(4, 8)) !== season) fail(`match key is not in season ${season}`);

  const $ = load(html);
  const warnings: string[] = [];

  // --- Header: round, venue, date, attendance; then one row per team with quarter scores.
  const headerCell = $('td')
    .filter((_, td) => cleanText($(td).children('b').first().text()) === 'Round:')
    .first();
  if (headerCell.length === 0) fail('no "Round:" header found');
  const header = HEADER.exec(cleanText(headerCell.text())) ?? fail('unrecognised header text');
  const [, rawRound = '', , rawDate = '', rawAttendance] = header;
  const venueName = cleanText(headerCell.find('a[href*="venues/"]').first().text());
  const venue = attempt(fail, () => venueByAfltablesName(venueName)).afltablesName;
  const round = attempt(fail, () => normaliseRound(rawRound));
  const when = attempt(fail, () => parsePageDateTime(rawDate));
  if (when.date.replaceAll('-', '') !== matchKey.slice(4)) {
    fail(`page date ${when.date} does not match the match key`);
  }

  const teamRows = headerCell
    .closest('table')
    .find('tr')
    .filter((_, tr) => $(tr).children('td').first().find('a[href*="/teams/"]').length > 0);
  if (teamRows.length !== 2) fail(`expected 2 team score rows, found ${teamRows.length}`);
  const sides = teamRows.toArray().map((tr) => {
    const cells = $(tr).children('td');
    const name = cleanText(cells.first().text());
    const teamId = attempt(fail, () => teamByAfltablesName(name, season)).teamId;
    const scoreText = cells
      .slice(1)
      .map((_, td) => $(td).text())
      .get()
      .join(' ');
    const quarters = attempt(fail, () => parseQuarterScores(scoreText));
    // parseQuarterScores guarantees at least 4 periods.
    return { name, teamId, quarters, final: quarters.at(-1) as QuarterScoreParsed };
  }) as [Side, Side];
  const [home, away] = sides;
  if (home.teamId === away.teamId) fail('home and away are the same team');

  // --- Box scores: the two "{Team} Match Statistics" tables.
  const statTables = $('table').filter((_, t) =>
    / Match Statistics\b/.test(cleanText($(t).find('thead tr').first().text())),
  );
  if (statTables.length !== 2)
    fail(`expected 2 Match Statistics tables, found ${statTables.length}`);

  const boxes = new Map<string, Box>();
  for (const table of statTables.toArray()) {
    const heading = cleanText($(table).find('thead tr').first().text());
    const teamName = /^(.+?) Match Statistics\b/.exec(heading)?.[1] ?? '';
    const side = sides.find((s) => s.name === teamName);
    if (!side) fail(`Match Statistics table for "${teamName}", who are not in the header`);
    if (boxes.has(side.teamId)) fail(`two Match Statistics tables for "${teamName}"`);
    boxes.set(side.teamId, readBox($, $(table), side, opts, warnings, fail));
  }

  const ordered = sides.map((s) => boxes.get(s.teamId) ?? fail(`no box score for ${s.name}`));
  const players = ordered.flatMap((b) => b.players);
  const ids = new Set(players.map((p) => p.player_id));
  if (ids.size !== players.length) fail('a player appears more than once');

  // --- Reconciliation (§12). Rushed behinds are counted for the team but not for any player.
  for (const [i, side] of sides.entries()) {
    const box = ordered[i] as Box;
    const sum = (col: StatColumn) => box.players.reduce((t, p) => t + (p[col] ?? 0), 0);
    const [goals, behinds, rushed] = [sum('gl'), sum('bh'), box.totals.rushed_behinds];
    const { cumGoals, cumBehinds } = side.final;
    if (goals !== cumGoals) fail(`${side.name}: Σ GL ${goals} ≠ team goals ${cumGoals}`);
    // The §12 check, reported separately because it pinpoints over-credited behinds.
    if (behinds > cumBehinds) fail(`${side.name}: Σ BH ${behinds} > team behinds ${cumBehinds}`);
    if (behinds + rushed !== cumBehinds) {
      fail(`${side.name}: Σ BH ${behinds} + rushed ${rushed} ≠ team behinds ${cumBehinds}`);
    }
    if (box.totals.stats.gl !== cumGoals || box.totals.stats.bh !== cumBehinds) {
      fail(`${side.name}: Totals row disagrees with the header score`);
    }
  }

  const match = validate(fail, ParsedMatchRow, {
    match_id: matchKey,
    squiggle_id: null,
    season,
    round_label: round.roundLabel,
    round_no: round.roundNo,
    is_final: round.isFinal,
    is_grand_final: round.isGrandFinal,
    start_utc: when.startUtc,
    local_time: when.localTime,
    venue,
    attendance: rawAttendance ? Number(rawAttendance.replaceAll(',', '')) : null,
    home_team_id: home.teamId,
    away_team_id: away.teamId,
    home_score: home.final.cumPoints,
    away_score: away.final.cumPoints,
  });

  const quarters = sides.flatMap((side) =>
    side.quarters.map((q) =>
      validate(fail, QuarterRow, {
        match_id: matchKey,
        team_id: side.teamId,
        quarter: q.quarter,
        goals: q.goals,
        behinds: q.behinds,
        points: q.points,
        cum_goals: q.cumGoals,
        cum_behinds: q.cumBehinds,
        cum_points: q.cumPoints,
      }),
    ),
  );

  return {
    match,
    quarters,
    players,
    people: ordered.flatMap((b) => b.people),
    teamTotals: ordered.map((b) => b.totals) as [TeamTotals, TeamTotals],
    warnings,
  };
}

interface Side {
  name: string;
  teamId: string;
  quarters: QuarterScoreParsed[];
  final: QuarterScoreParsed;
}

interface Box {
  players: PlayerMatchRow[];
  people: PlayerRow[];
  totals: TeamTotals;
}

type Fail = (message: string) => never;
/** A DOM node, typed without importing cheerio's `domhandler` dependency directly. */
type Node = Parameters<CheerioAPI['contains']>[0];
/** The zod schema surface used here, so ingest needs no direct zod import. */
interface Schema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

function readBox(
  $: CheerioAPI,
  table: Cheerio<Node>,
  side: Side,
  { season, matchKey }: MatchPageOptions,
  warnings: string[],
  fail: Fail,
): Box {
  // Header text by grid position, from the last header row.
  const headers = gridCells($, table.find('thead tr').last());
  const posOf = new Map<string, number>();
  for (const [pos, cell] of headers) {
    const code = cleanText(cell.text());
    if (code === '') continue; // spacer cell, not a column
    if (posOf.has(code)) fail(`${side.name}: duplicate column "${code}"`);
    posOf.set(code, pos);
    if (!REQUIRED_HEADERS.includes(code) && !STAT_BY_CODE.has(code)) {
      warnings.push(`${side.name}: unknown column "${code}"`);
    }
  }
  for (const code of REQUIRED_HEADERS) {
    if (!posOf.has(code)) fail(`${side.name}: missing column "${code}"`);
  }
  for (const def of STAT_DEFINITIONS) {
    if (!posOf.has(def.code)) warnings.push(`${side.name}: missing column "${def.code}"`);
  }

  const readStats = (cells: Map<number, Cheerio<Node>>, label: string): StatValues => {
    const stats = {} as Record<StatColumn, number | null>;
    for (const def of STAT_DEFINITIONS) {
      const pos = posOf.get(def.code);
      stats[def.column] =
        pos === undefined
          ? null
          : attempt(
              (m) => fail(`${side.name} ${label}: ${m}`),
              () => statValue(cellText(cells, pos), def, season),
            );
    }
    return stats;
  };

  const players: PlayerMatchRow[] = [];
  const people: PlayerRow[] = [];
  for (const tr of table.find('tbody tr').toArray()) {
    const cells = gridCells($, $(tr));
    const link = cells
      .get(posOf.get('Player') as number)
      ?.find('a[href*="players/"]')
      .first();
    const href = link?.attr('href') ?? '';
    const playerId = PLAYER_HREF.exec(href)?.[1] ?? fail(`${side.name}: player row without a link`);
    const name = cleanText(link?.text() ?? '');

    const jumperText = cellText(cells, posOf.get('#'));
    const [, jumper, marker] =
      JUMPER.exec(jumperText) ?? fail(`${side.name}: ${playerId} has jumper "${jumperText}"`);

    const stats = readStats(cells, playerId);
    players.push(
      validate(fail, PlayerMatchRow, {
        match_id: matchKey,
        player_id: playerId,
        team_id: side.teamId,
        jumper: jumper === undefined ? null : Number(jumper),
        sub_status: marker === '↑' ? 'on' : marker === '↓' ? 'off' : null,
        ...orderedStats(stats),
      }),
    );
    people.push(validate(fail, PlayerRow, personFrom(playerId, name)));
  }
  if (players.length < PLAYERS_PER_TEAM.min || players.length > PLAYERS_PER_TEAM.max) {
    fail(`${side.name}: ${players.length} players, expected 22–23`);
  }

  // Footer: "Rushed" (only when > 0) and "Totals"; "Opposition" repeats the other side.
  let rushed = 0;
  let totals: StatValues | undefined;
  for (const tr of table.find('tfoot tr').toArray()) {
    const cells = gridCells($, $(tr));
    const label = cellText(cells, 0);
    if (label === 'Rushed') {
      const text = cellText(cells, posOf.get('BH'));
      if (!/^\d+$/.test(text)) fail(`${side.name}: rushed behinds "${text}"`);
      rushed = Number(text);
    } else if (label === 'Totals') {
      // %P is blank in the Totals row: it has no team meaning, so keep it NULL rather than 0.
      totals = { ...readStats(cells, 'Totals'), pct_played: null };
    }
  }
  if (!totals) fail(`${side.name}: no Totals row`);

  return {
    players,
    people,
    totals: {
      team_id: side.teamId,
      rushed_behinds: rushed,
      stats: validate(fail, StatValues, orderedStats(totals)),
    },
  };
}

/** A row's cells keyed by grid position (each cell starts after the previous one's colspan). */
function gridCells($: CheerioAPI, row: Cheerio<Node>): Map<number, Cheerio<Node>> {
  const cells = new Map<number, Cheerio<Node>>();
  let pos = 0;
  for (const el of row.children('td, th').toArray()) {
    const cell = $(el);
    cells.set(pos, cell);
    pos += Math.max(1, Number(cell.attr('colspan') ?? 1) || 1);
  }
  return cells;
}

/** Cleaned text of the cell at a grid position; blank when there is none. */
function cellText(cells: Map<number, Cheerio<Node>>, pos: number | undefined): string {
  return cleanText((pos === undefined ? undefined : cells.get(pos))?.text() ?? '');
}

function orderedStats(stats: Record<StatColumn, number | null>): StatValues {
  return Object.fromEntries(STAT_COLUMNS.map((c) => [c, stats[c]])) as StatValues;
}

function personFrom(playerId: string, pageName: string): PlayerRow {
  const comma = pageName.indexOf(',');
  if (comma < 0) {
    return { player_id: playerId, display_name: pageName, first_name: null, surname: null };
  }
  const surname = pageName.slice(0, comma).trim();
  const first = pageName.slice(comma + 1).trim();
  return {
    player_id: playerId,
    display_name: `${first} ${surname}`.trim(),
    first_name: first || null,
    surname: surname || null,
  };
}

function validate<T>(fail: Fail, schema: Schema<T>, value: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fail(`invalid row: ${result.error.message}`);
}

function attempt<T>(fail: Fail, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
