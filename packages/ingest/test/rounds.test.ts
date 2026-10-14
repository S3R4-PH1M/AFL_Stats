import { describe, expect, it } from 'vitest';
import { normaliseRound, UnknownRoundError } from '../src/afltables/rounds.ts';

describe('normaliseRound', () => {
  it.each([
    ['10', 10],
    ['Round 10', 10],
    ['Round 1 * see notes', 1],
    [' Round  3 ', 3],
  ])('reads home-and-away label %j', (raw, roundNo) => {
    expect(normaliseRound(raw)).toEqual({
      roundLabel: `Round ${roundNo}`,
      roundNo,
      isFinal: false,
      isGrandFinal: false,
    });
  });

  it.each([
    'Qualifying Final',
    'Elimination Final',
    'Semi Final',
    'Preliminary Final',
    'Grand Final',
  ])('reads finals label %j', (label) => {
    expect(normaliseRound(label)).toEqual({
      roundLabel: label,
      roundNo: null,
      isFinal: true,
      isGrandFinal: label === 'Grand Final',
    });
  });

  it.each(['', 'Finals', 'Round', 'Round 0', 'Ladder', 'Grand Finals'])(
    'rejects %j',
    (raw) => {
      expect(() => normaliseRound(raw)).toThrow(UnknownRoundError);
    },
  );
});
