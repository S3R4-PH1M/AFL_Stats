import { FIRST_SEASON } from '@afl/core';
import { describe, expect, it } from 'vitest';
import { parseSeasonArg } from '../src/seasonArg.ts';

describe('parseSeasonArg', () => {
  it('accepts a four-digit season from 2003', () => {
    expect(FIRST_SEASON).toBe(2003);
    expect(parseSeasonArg('2003')).toBe(2003);
    expect(parseSeasonArg('2025')).toBe(2025);
  });

  it.each([undefined, '', '0', '1990', '2002', '2101', '2025.5', '02025', ' 2025', 'abc'])(
    'rejects %j with a message naming the range and M7',
    (value) => {
      const result = parseSeasonArg(value);
      expect(typeof result).toBe('string');
      expect(result).toMatch(/--season must be a year from 2003 to 2100 .*M7/);
    },
  );
});
