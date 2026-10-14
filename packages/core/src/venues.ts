/**
 * AFL Tables venue names → neutral display name and IANA time zone (task 9.1).
 * Times normally come from Squiggle `unixtime` or the page's bracketed AEST time (§6.4.6);
 * the zone is the last-resort fallback.
 *
 * Covers every venue in the fixtures (2003 and 2025). Squiggle uses the same names.
 * Add others (e.g. Wellington, Jiangwan Stadium) from real pages when the backfill reports them.
 */
export interface Venue {
  readonly afltablesName: string;
  readonly name: string;
  readonly timeZone: string;
}

export const VENUES: readonly Venue[] = [
  venue('Adelaide Oval', 'Adelaide Oval', 'Australia/Adelaide'),
  venue('Barossa Park', 'Barossa Park', 'Australia/Adelaide'),
  venue('Bellerive Oval', 'Bellerive Oval', 'Australia/Hobart'),
  venue('Carrara', 'Carrara Stadium', 'Australia/Brisbane'),
  venue('Docklands', 'Docklands Stadium', 'Australia/Melbourne'),
  venue('Eureka Stadium', 'Eureka Stadium', 'Australia/Melbourne'),
  venue('Football Park', 'Football Park', 'Australia/Adelaide'),
  venue('Gabba', 'The Gabba', 'Australia/Brisbane'),
  venue('Hands Oval', 'Hands Oval', 'Australia/Perth'),
  venue('Kardinia Park', 'Kardinia Park', 'Australia/Melbourne'),
  venue('M.C.G.', 'MCG', 'Australia/Melbourne'),
  venue('Manuka Oval', 'Manuka Oval', 'Australia/Sydney'),
  venue('Marrara Oval', 'Marrara Oval', 'Australia/Darwin'),
  venue('Norwood Oval', 'Norwood Oval', 'Australia/Adelaide'),
  venue('Perth Stadium', 'Perth Stadium', 'Australia/Perth'),
  venue('Princes Park', 'Princes Park', 'Australia/Melbourne'),
  venue('S.C.G.', 'SCG', 'Australia/Sydney'),
  venue('Stadium Australia', 'Stadium Australia', 'Australia/Sydney'),
  venue('Subiaco', 'Subiaco Oval', 'Australia/Perth'),
  venue('Sydney Showground', 'Sydney Showground Stadium', 'Australia/Sydney'),
  venue('Traeger Park', 'Traeger Park', 'Australia/Darwin'),
  venue('York Park', 'York Park', 'Australia/Hobart'),
];

function venue(afltablesName: string, name: string, timeZone: string): Venue {
  return { afltablesName, name, timeZone };
}

export class UnknownVenueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownVenueError';
  }
}

const byAfltablesName = new Map(VENUES.map((v) => [v.afltablesName, v] as const));

export function venueByAfltablesName(name: string): Venue {
  const found = byAfltablesName.get(name.trim());
  if (!found) throw new UnknownVenueError(`Unmapped AFL Tables venue "${name}"`);
  return found;
}
