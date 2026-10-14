import { vi } from 'vitest';

/** Tests must never reach afltables.com or Squiggle (CLAUDE.md). Any real `fetch` fails loudly. */
vi.stubGlobal('fetch', () => {
  throw new Error('Network access is forbidden in tests: inject a fake fetch');
});
