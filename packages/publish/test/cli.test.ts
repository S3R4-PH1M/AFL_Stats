import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWarehouse, closeDb, openDb } from '@afl/warehouse';
import { fixtureCache } from '@afl/warehouse/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';

let tmp: string;
let dbPath: string;
let lines: string[];
const log = (line: string) => lines.push(line);

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'afl-publish-cli-'));
  dbPath = join(tmp, 'afl.duckdb');
  const { cache, cleanup } = await fixtureCache();
  const db = await openDb(dbPath);
  try {
    await buildWarehouse({ conn: db.conn, cache });
  } finally {
    closeDb(db);
    await cleanup();
  }
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

describe('npm run publish', () => {
  it('publishes a built warehouse to --out and exits 0', async () => {
    lines = [];
    const out = join(tmp, 'out', 'v1');
    expect(await main(['--db', dbPath, '--out', out], log)).toBe(0);
    const meta = JSON.parse(await readFile(join(out, 'meta.json'), 'utf8'));
    expect(meta.seasons).toEqual([2003, 2025]);
    expect(lines.at(-1)).toMatch(/publish: 10 files \(2 seasons, 5 matches\) → /);
  });

  it('exits 2 when the database is missing', async () => {
    lines = [];
    expect(await main(['--db', join(tmp, 'missing.duckdb')], log)).toBe(2);
    expect(lines.join('\n')).toMatch(/not found; run npm run db:build first/);
  });

  it('exits 2 on an unknown option', async () => {
    lines = [];
    expect(await main(['--bogus'], log)).toBe(2);
    expect(lines.at(-1)).toMatch(/^usage: npm run publish/);
  });
});
