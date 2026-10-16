import { describe, expect, it } from 'vitest';
import { ladder } from '../test/sample.ts';
import { parseRoundSearch, roundOptions, selectRound, sortLadder } from './ladder.ts';

describe('roundOptions', () => {
  it('lists the published rounds with their labels, Opening Round first', () => {
    expect(roundOptions(ladder)).toEqual([
      { roundNo: 0, roundLabel: 'Opening Round' },
      { roundNo: 1, roundLabel: 'Round 1' },
    ]);
  });
});

describe('selectRound', () => {
  it('defaults to the latest round', () => {
    expect(selectRound(ladder)?.roundNo).toBe(1);
  });

  it('selects a requested round, including round 0', () => {
    expect(selectRound(ladder, 0)?.roundLabel).toBe('Opening Round');
  });

  it('falls back to the latest round for an unknown round', () => {
    expect(selectRound(ladder, 17)?.roundNo).toBe(1);
  });

  it('returns undefined when no round is published yet', () => {
    expect(selectRound({ season: 2026, rounds: [] })).toBeUndefined();
  });
});

describe('sortLadder', () => {
  it('orders rows by rank without changing the input', () => {
    const rows = ladder.rounds[1]?.rows ?? [];
    const shuffled = [rows[2], rows[0], rows[1]].filter((r) => r !== undefined);
    expect(sortLadder(shuffled).map((r) => r.teamId)).toEqual(['richmond', 'adelaide', 'essendon']);
    expect(shuffled.map((r) => r.rank)).toEqual([3, 1, 2]);
  });
});

describe('parseRoundSearch', () => {
  it.each([
    [9, { round: 9 }],
    [0, { round: 0 }],
    ['9', { round: 9 }],
    [undefined, {}],
    ['', {}],
    [-1, {}],
    [1.5, {}],
    ['nine', {}],
  ])('%j → %j', (value, expected) => {
    expect(parseRoundSearch(value)).toEqual(expected);
  });
});
