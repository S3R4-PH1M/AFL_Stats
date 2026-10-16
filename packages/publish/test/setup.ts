import { vi } from 'vitest';

/** Tests must never reach afltables.com or Squiggle (CLAUDE.md). Publish reads the warehouse only. */
vi.stubGlobal('fetch', () => {
  throw new Error('Network access is forbidden in tests: publish reads the warehouse only');
});
