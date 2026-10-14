/**
 * `npm run db:test [-- --db <path>]` (task 9.8): runs every SQL data test against the built
 * database, prints up to 10 failing rows per test, and exits 1 if any test fails.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { closeDb, openDb } from './db.ts';
import { reportSqlTests, runSqlTests } from './tests.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function main(argv: string[]): Promise<number> {
  let dbArg: string | undefined;
  try {
    dbArg = parseArgs({ args: argv, strict: true, options: { db: { type: 'string' } } }).values.db;
  } catch (error) {
    console.error((error as Error).message);
    console.error('usage: npm run db:test -- [--db <path>]');
    return 2;
  }
  const dbPath = resolve(dbArg ?? join(REPO_ROOT, 'data', 'afl.duckdb'));
  if (!existsSync(dbPath)) {
    console.error(`db:test: ${dbPath} not found; run npm run db:build first`);
    return 2;
  }
  const db = await openDb(dbPath, { readOnly: true });
  try {
    console.log(`db:test on ${dbPath}`);
    return reportSqlTests(await runSqlTests(db.conn), (line) => console.log(line));
  } finally {
    closeDb(db);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
