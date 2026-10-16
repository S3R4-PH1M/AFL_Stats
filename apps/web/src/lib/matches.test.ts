import { describe, expect, it } from 'vitest';
import { matches, meta } from '../test/sample.ts';
import { groupByRound, teamNames } from './matches.ts';

describe('groupByRound', () => {
  it('groups matches by round in file order, with finals last', () => {
    expect(
      groupByRound(matches.matches).map((g) => [g.roundLabel, g.matches.map((m) => m.matchId)]),
    ).toEqual([
      ['Opening Round', ['010520250322']],
      ['Round 1', ['141820250511']],
      ['Grand Final', ['091920250927']],
    ]);
  });

  it('keeps each final separate even though finals have no round number', () => {
    const [gf] = matches.matches.slice(-1);
    if (!gf) throw new Error('no final');
    const semi = { ...gf, matchId: '010220250913', roundLabel: 'Semi Final', isGrandFinal: false };
    const groups = groupByRound([semi, gf]);
    expect(groups.map((g) => g.roundLabel)).toEqual(['Semi Final', 'Grand Final']);
  });
});

describe('teamNames', () => {
  it('maps team ids to names, falling back to the id', () => {
    const name = teamNames(meta);
    expect(name('west-coast')).toBe('West Coast');
    expect(name('unknown-team')).toBe('unknown-team');
  });
});
