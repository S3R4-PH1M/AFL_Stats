/**
 * `npm run ingest -- --season 2025 [--force] [--offline] [--cache-dir <dir>]` (task 9.7).
 *
 * Fills the raw cache for one season (see `ingest.ts`). Reads `CONTACT_EMAIL` from the
 * environment, after loading `<repo>/.env` if it exists; `--offline` needs no email and never
 * touches the network. Never prints the email or the User-Agent.
 *
 * Exit codes: 0 OK (including matches not yet published), 1 when any match failed,
 * 2 when the run aborted or couldn't start (bad arguments, no email, offline cache miss).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FsRawCache } from './cache.ts';
import { contactEmailFromEnv, createHttpClient } from './http.ts';
import { formatSummary, runIngest } from './ingest.ts';

const USAGE = 'usage: npm run ingest -- --season <YYYY> [--force] [--offline] [--cache-dir <dir>]';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface CliIo {
  env: NodeJS.ProcessEnv;
  /** Repo root: holds `.env`, and `data/raw` is the default cache. */
  rootDir: string;
  out: (line: string) => void;
  err: (line: string) => void;
  fetch?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
}

const defaultIo: CliIo = {
  env: process.env,
  rootDir: REPO_ROOT,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

interface CliArgs {
  season: number;
  force: boolean;
  offline: boolean;
  cacheDir: string | undefined;
}

function parseCliArgs(argv: string[]): CliArgs | string {
  let values: ReturnType<typeof parse>['values'];
  try {
    values = parse(argv).values;
  } catch (error) {
    return (error as Error).message;
  }
  const season = Number(values.season);
  if (!values.season || !Number.isInteger(season) || season < 1897 || season > 2100) {
    return `--season must be a year from 1897 to 2100 (got ${values.season ?? 'nothing'})`;
  }
  return {
    season,
    force: values.force ?? false,
    offline: values.offline ?? false,
    cacheDir: values['cache-dir'],
  };
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      season: { type: 'string' },
      force: { type: 'boolean' },
      offline: { type: 'boolean' },
      'cache-dir': { type: 'string' },
    },
  });
}

export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const args = parseCliArgs(argv);
  if (typeof args === 'string') {
    io.err(args);
    io.err(USAGE);
    return 2;
  }

  const envFile = join(io.rootDir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const now = io.now ?? Date.now;
  const cache = new FsRawCache(resolve(args.cacheDir ?? join(io.rootDir, 'data', 'raw')));
  try {
    const http = createHttpClient({
      cache,
      contactEmail: contactEmailFromEnv(io.env),
      offline: args.offline,
      fetch: io.fetch,
      sleep: io.sleep,
      now,
    });
    const summary = await runIngest(
      { season: args.season, force: args.force },
      { http, cache, now },
    );
    io.out(formatSummary(summary));
    if (summary.aborted) return 2;
    return summary.failed.length > 0 ? 1 : 0;
  } catch (error) {
    io.err(`ingest ${args.season} failed: ${(error as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
