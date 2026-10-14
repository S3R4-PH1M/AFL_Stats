/** DuckDB schema, loaders, SQL models and data tests (proposal §5). */
export { DATA_CONTRACT_VERSION } from '@afl/core';

export const PACKAGE = '@afl/warehouse';

export * from './build.ts';
export * from './db.ts';
export * from './load.ts';
export * from './sqlgen.ts';
export * from './tests.ts';
