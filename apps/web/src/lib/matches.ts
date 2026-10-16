import type { MatchSummary, MetaFile } from '@afl/core';

export interface RoundGroup {
  roundLabel: string;
  roundNo: number | null;
  matches: MatchSummary[];
}

/**
 * Matches grouped by round, in file order (`matches.json` puts finals last). Finals have no round
 * number, so each groups by its label.
 */
export function groupByRound(matches: readonly MatchSummary[]): RoundGroup[] {
  const groups = new Map<string, RoundGroup>();
  for (const m of matches) {
    const key = m.roundNo === null ? `final ${m.roundLabel}` : `round ${m.roundNo}`;
    const group = groups.get(key);
    if (group) group.matches.push(m);
    else groups.set(key, { roundLabel: m.roundLabel, roundNo: m.roundNo, matches: [m] });
  }
  return [...groups.values()];
}

export type TeamName = (teamId: string) => string;

/** Team id → display name from `meta.json`, falling back to the id. */
export function teamNames(meta: MetaFile): TeamName {
  const names = new Map(meta.teams.map((t) => [t.teamId, t.name]));
  return (teamId) => names.get(teamId) ?? teamId;
}

type Sides = Pick<MatchSummary, 'home' | 'away'>;

/** "Home v Away". */
export function matchTitle({ home, away }: Sides, name: TeamName): string {
  return `${name(home.teamId)} v ${name(away.teamId)}`;
}

/** "Richmond won by 2 points" or "Match drawn". */
export function resultText({ home, away }: Sides, name: TeamName): string {
  const margin = Math.abs(home.score - away.score);
  if (margin === 0) return 'Match drawn';
  const winner = home.score > away.score ? home : away;
  return `${name(winner.teamId)} won by ${margin} ${margin === 1 ? 'point' : 'points'}`;
}
