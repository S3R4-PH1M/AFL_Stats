/** Shared types, zod schemas, team/venue maps and stat definitions (proposal §5). */
export const PACKAGE = '@afl/core';

/** Version of the published data contract (proposal §10). */
export const DATA_CONTRACT_VERSION = 'v1';

export * from './schemas.ts';
export * from './stats.ts';
export * from './teams.ts';
export * from './venues.ts';
