import { vi } from 'vitest';

/** Tests must never reach afltables.com or Squiggle (CLAUDE.md). The build reads the raw cache only. */
vi.stubGlobal('fetch', () => {
  throw new Error('Network access is forbidden in tests: the warehouse reads the raw cache only');
});
