import { describe, expect, it } from 'vitest';
import { DATA_CONTRACT_VERSION, PACKAGE } from '../src/index.ts';

describe('@afl/core', () => {
  it('exports its identity and contract version', () => {
    expect(PACKAGE).toBe('@afl/core');
    expect(DATA_CONTRACT_VERSION).toBe('v1');
  });
});
