/**
 * `npm run fixtures:seed -- --raw <dir> [--force]` (task 9.9): writes the committed fixtures into a
 * raw cache, so CI can run `rebuild` and build the web app with fixture data (proposal §13).
 *
 * Refuses a non-empty directory unless `--force`, so it never overwrites a real raw cache.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FIXTURE_URLS, seedFixtureCache } from './fixtureCache.ts';

const USAGE = 'usage: npm run fixtures:seed -- --raw <dir> [--force]';

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

export async function seedRaw(argv: string[], log: (line: string) => void): Promise<number> {
  let values: { raw?: string; force?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { raw: { type: 'string' }, force: { type: 'boolean' } },
    }));
  } catch (error) {
    log((error as Error).message);
    log(USAGE);
    return 2;
  }
  if (!values.raw) {
    log('--raw <dir> is required');
    log(USAGE);
    return 2;
  }
  const dir = resolve(values.raw);
  if (!values.force && !(await isEmptyDir(dir))) {
    log(`fixtures:seed: ${dir} is not empty; pass --force to seed it anyway`);
    return 2;
  }
  await seedFixtureCache(dir);
  log(`fixtures:seed: ${Object.keys(FIXTURE_URLS).length} fixture pages → ${dir}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await seedRaw(process.argv.slice(2), (line) => console.log(line));
}
