import { describe, expect, it } from 'vitest';
import {
  DATA_CONTRACT_VERSION,
  MatchRow,
  PACKAGE,
  STAT_DEFINITIONS,
  TEAMS,
  VENUES,
} from '../src/index.ts';

describe('@afl/core', () => {
  it('exports its identity and contract version', () => {
    expect(PACKAGE).toBe('@afl/core');
    expect(DATA_CONTRACT_VERSION).toBe('v1');
  });

  it('re-exports teams, venues, stats and schemas', () => {
    expect(TEAMS).toHaveLength(18);
    expect(VENUES.length).toBeGreaterThan(0);
    expect(STAT_DEFINITIONS).toHaveLength(23);
    expect(typeof MatchRow.parse).toBe('function');
  });
});
