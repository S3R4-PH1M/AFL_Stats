import { describe, expect, it } from 'vitest';
import { DATA_CONTRACT_VERSION, PACKAGE } from '../src/index.ts';

describe('@afl/ingest', () => {
  it('exports its identity and resolves @afl/core', () => {
    expect(PACKAGE).toBe('@afl/ingest');
    expect(DATA_CONTRACT_VERSION).toBe('v1');
  });
});
