import { describe, expect, it } from 'vitest';
import {
  TEAMS,
  teamByAfltablesName,
  teamById,
  teamBySquiggleId,
  UnknownTeamError,
} from '../src/teams.ts';
import { readFixture, readJsonFixture, uniqueMatches } from './fixtures.ts';

interface SquiggleTeam {
  id: number;
  name: string;
  abbrev: string;
}

const squiggleTeams = readJsonFixture<{ teams: SquiggleTeam[] }>('squiggle/teams.json').teams;
const teamNamePattern = /teams\/\w+_idx\.html">([^<]+)</g;

describe('teams', () => {
  it('has 18 clubs with unique ids, Squiggle ids and AFL Tables names', () => {
    expect(TEAMS).toHaveLength(18);
    expect(new Set(TEAMS.map((t) => t.teamId)).size).toBe(18);
    expect(new Set(TEAMS.map((t) => t.squiggleId)).size).toBe(18);
    const names = TEAMS.flatMap((t) => t.afltablesNames);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TEAMS) expect(t.teamId).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('maps every Squiggle team, with name and abbrev copied from the fixture', () => {
    expect(squiggleTeams).toHaveLength(18);
    for (const s of squiggleTeams) {
      const t = teamBySquiggleId(s.id);
      expect(t.name).toBe(s.name);
      expect(t.abbrev).toBe(s.abbrev);
      expect(TEAMS.filter((x) => x.squiggleId === s.id)).toHaveLength(1);
    }
  });

  it.each([
    [2025, 18],
    [2003, 16],
  ])('maps every team name on seas-%i.html to exactly one club', (season, clubs) => {
    const names = uniqueMatches(readFixture(`afltables/seas-${season}.html`), teamNamePattern);
    expect(names).toHaveLength(clubs);
    const ids = names.map((n) => teamByAfltablesName(n, season).teamId);
    expect(new Set(ids).size).toBe(clubs);
    for (const n of names) {
      expect(TEAMS.filter((t) => t.afltablesNames.includes(n))).toHaveLength(1);
    }
  });

  it('maps the 2003 "Kangaroos" to North Melbourne', () => {
    expect(teamByAfltablesName('Kangaroos', 2003).teamId).toBe('north-melbourne');
  });

  it('names the team and season when a team is unmapped', () => {
    expect(() => teamByAfltablesName('Fitzroy', 1996)).toThrow(UnknownTeamError);
    expect(() => teamByAfltablesName('Fitzroy', 1996)).toThrow(/"Fitzroy" in season 1996/);
    expect(() => teamBySquiggleId(99)).toThrow(UnknownTeamError);
    expect(() => teamById('nope')).toThrow(UnknownTeamError);
  });
});
