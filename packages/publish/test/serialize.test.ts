import { SeasonLadderFile } from '@afl/core';
import { describe, expect, it } from 'vitest';
import { PublishValidationError, serialize } from '../src/files.ts';

const row = {
  rank: 1,
  teamId: 'adelaide',
  played: 1,
  wins: 1,
  losses: 0,
  draws: 0,
  pts: 4,
  pointsFor: 161,
  pointsAgainst: 100,
  percentage: 161,
};
const ladder = { season: 2025, rounds: [{ roundNo: 2, roundLabel: 'Round 2', rows: [row] }] };
const file = (data: unknown) => ({
  path: 'seasons/2025/ladder.json',
  schema: SeasonLadderFile,
  data,
});

describe('serialize', () => {
  it('writes compact JSON with a trailing newline that round-trips', () => {
    const text = serialize(file(ladder));
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(2);
    expect(JSON.parse(text)).toEqual(ladder);
  });

  it('writes keys in schema order, whatever order the data has', () => {
    const shuffled = {
      rounds: [
        {
          rows: [{ ...row }].map((r) => Object.fromEntries(Object.entries(r).reverse())),
          roundLabel: 'Round 2',
          roundNo: 2,
        },
      ],
      season: 2025,
    };
    expect(serialize(file(shuffled))).toBe(serialize(file(ladder)));
    expect(serialize(file(ladder))).toMatch(
      /^\{"season":2025,"rounds":\[\{"roundNo":2,"roundLabel"/,
    );
  });

  it('throws naming the file and each invalid field', () => {
    const bad = {
      ...ladder,
      rounds: [{ ...ladder.rounds[0], rows: [{ ...row, teamId: 'Adelaide', pts: -4 }] }],
    };
    let error: unknown;
    try {
      serialize(file(bad));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PublishValidationError);
    const message = (error as Error).message;
    expect(message).toContain('seasons/2025/ladder.json is invalid');
    expect(message).toContain('rounds.0.rows.0.teamId');
    expect(message).toContain('rounds.0.rows.0.pts');
  });

  it('rejects unknown keys (strict schemas)', () => {
    expect(() => serialize(file({ ...ladder, extra: true }))).toThrow(PublishValidationError);
  });
});
