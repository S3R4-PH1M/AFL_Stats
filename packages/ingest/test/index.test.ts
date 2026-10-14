import { describe, expect, it } from 'vitest';
import {
  cacheKeyForUrl,
  createHttpClient,
  DATA_CONTRACT_VERSION,
  FsRawCache,
  PACKAGE,
} from '../src/index.ts';

describe('@afl/ingest', () => {
  it('exports its identity and resolves @afl/core', () => {
    expect(PACKAGE).toBe('@afl/ingest');
    expect(DATA_CONTRACT_VERSION).toBe('v1');
  });

  it('exports the HTTP client and raw cache', () => {
    expect(typeof createHttpClient).toBe('function');
    expect(typeof FsRawCache).toBe('function');
    expect(typeof cacheKeyForUrl).toBe('function');
  });
});
