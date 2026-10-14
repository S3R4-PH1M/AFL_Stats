/** HTTP client, raw cache, source adapters and parsers (proposal §5). */
export { DATA_CONTRACT_VERSION } from '@afl/core';

export const PACKAGE = '@afl/ingest';

export * from './afltables/decode.ts';
export * from './afltables/matchPage.ts';
export * from './afltables/parseScore.ts';
export * from './afltables/rounds.ts';
export * from './afltables/seasonPage.ts';
export * from './afltables/time.ts';
export * from './cache.ts';
export * from './http.ts';
export * from './ingest.ts';
export * from './seasonArg.ts';
export * from './squiggle/client.ts';
export * from './squiggle/map.ts';
