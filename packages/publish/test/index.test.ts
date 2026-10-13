import { describe, expect, it } from 'vitest';
import { DATA_CONTRACT_VERSION, PACKAGE } from '../src/index.ts';

describe('@afl/publish', () => {
  it('exports its identity and resolves @afl/core', () => {
    expect(PACKAGE).toBe('@afl/publish');
    expect(DATA_CONTRACT_VERSION).toBe('v1');
  });
});
