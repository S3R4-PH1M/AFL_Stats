/**
 * `npm run publish [-- --db <path>] [--out <dir>]` (task 9.9): writes the `v1` JSON files from the
 * built warehouse into `apps/web/public/data/v1` (proposal §10). Exits 0 on success, 1 if any
 * file is invalid or the run fails, and 2 for bad arguments or a missing database.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DATA_CONTRACT_VERSION } from '@afl/core';
import { closeDb, openDb } from '@afl/warehouse';
import { publish } from './publish.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const USAGE = 'usage: npm run publish -- [--db <path>] [--out <dir>]';

export async function main(argv: string[], log: (line: string) => void): Promise<number> {
  let values: { db?: string; out?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { db: { type: 'string' }, out: { type: 'string' } },
    }));
  } catch (error) {
    log((error as Error).message);
    log(USAGE);
    return 2;
  }
  const dbPath = resolve(values.db ?? join(REPO_ROOT, 'data', 'afl.duckdb'));
  const outDir = resolve(
    values.out ?? join(REPO_ROOT, 'apps', 'web', 'public', 'data', DATA_CONTRACT_VERSION),
  );
  if (!existsSync(dbPath)) {
    log(`publish: ${dbPath} not found; run npm run db:build first`);
    return 2;
  }
  const db = await openDb(dbPath, { readOnly: true });
  try {
    log(`publish from ${dbPath}`);
    const report = await publish({ conn: db.conn, outDir, log });
    log(
      `publish: ${report.files} files (${report.seasons.length} seasons, ${report.matches} matches) → ${outDir}`,
    );
    return 0;
  } catch (error) {
    log(`publish failed: ${(error as Error).message}`);
    return 1;
  } finally {
    closeDb(db);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2), (line) => console.log(line));
}
