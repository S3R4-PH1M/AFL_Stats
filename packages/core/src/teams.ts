/**
 * The 18 current AFL clubs (proposal §6.4.4, task 9.1).
 *
 * `name`, `abbrev` and `squiggleId` are copied from Squiggle `?q=teams`
 * (`packages/ingest/test/fixtures/squiggle/teams.json`), never guessed.
 * `afltablesNames` lists every name AFL Tables uses for the club since 2003.
 */
export interface Team {
  /** Stable, URL-safe slug used as `team_id` everywhere. */
  readonly teamId: string;
  readonly name: string;
  readonly abbrev: string;
  readonly squiggleId: number;
  readonly afltablesNames: readonly string[];
  /** Predecessor club, filled in for the pre-2003 results history (M7). */
  readonly lineageOf: string | null;
}

export const TEAMS: readonly Team[] = [
  team('adelaide', 'Adelaide', 'ADE', 1),
  team('brisbane-lions', 'Brisbane Lions', 'BRI', 2),
  team('carlton', 'Carlton', 'CAR', 3),
  team('collingwood', 'Collingwood', 'COL', 4),
  team('essendon', 'Essendon', 'ESS', 5),
  team('fremantle', 'Fremantle', 'FRE', 6),
  team('geelong', 'Geelong', 'GEE', 7),
  team('gold-coast', 'Gold Coast', 'GCS', 8),
  team('gws', 'Greater Western Sydney', 'GWS', 9),
  team('hawthorn', 'Hawthorn', 'HAW', 10),
  team('melbourne', 'Melbourne', 'MEL', 11),
  // AFL Tables lists North Melbourne as "Kangaroos" in 2003 (and other seasons it played under that name).
  team('north-melbourne', 'North Melbourne', 'NOR', 12, ['Kangaroos']),
  team('port-adelaide', 'Port Adelaide', 'POR', 13),
  team('richmond', 'Richmond', 'RIC', 14),
  team('st-kilda', 'St Kilda', 'STK', 15),
  team('sydney', 'Sydney', 'SYD', 16),
  team('west-coast', 'West Coast', 'WCE', 17),
  team('western-bulldogs', 'Western Bulldogs', 'WBD', 18),
];

function team(
  teamId: string,
  name: string,
  abbrev: string,
  squiggleId: number,
  otherAfltablesNames: readonly string[] = [],
): Team {
  return {
    teamId,
    name,
    abbrev,
    squiggleId,
    afltablesNames: [name, ...otherAfltablesNames],
    lineageOf: null,
  };
}

export class UnknownTeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownTeamError';
  }
}

const byAfltablesName = new Map(TEAMS.flatMap((t) => t.afltablesNames.map((n) => [n, t] as const)));
const bySquiggleId = new Map(TEAMS.map((t) => [t.squiggleId, t] as const));
const byTeamId = new Map(TEAMS.map((t) => [t.teamId, t] as const));

/** Maps an AFL Tables team name to its club. The season only makes the error actionable. */
export function teamByAfltablesName(name: string, season: number): Team {
  const found = byAfltablesName.get(name.trim());
  if (!found) {
    throw new UnknownTeamError(`Unmapped AFL Tables team "${name}" in season ${season}`);
  }
  return found;
}

export function teamBySquiggleId(id: number): Team {
  const found = bySquiggleId.get(id);
  if (!found) throw new UnknownTeamError(`Unmapped Squiggle team id ${id}`);
  return found;
}

export function teamById(teamId: string): Team {
  const found = byTeamId.get(teamId);
  if (!found) throw new UnknownTeamError(`Unknown team_id "${teamId}"`);
  return found;
}
