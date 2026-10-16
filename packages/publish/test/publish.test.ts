import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { closeDb, type Db, exec } from '@afl/warehouse';
import { buildFixtureDb } from '@afl/warehouse/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublishValidationError } from '../src/files.ts';
import { publish } from '../src/publish.ts';

/** Every file under `dir`, as sorted `/`-separated relative paths. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

const EXPECTED_FILES = [
  'matches/2003/010320030629.json',
  'matches/2025/010520250322.json',
  'matches/2025/091920250927.json',
  'matches/2025/121920250511.json',
  'matches/2025/141820250511.json',
  'meta.json',
  'seasons/2003/ladder.json',
  'seasons/2003/matches.json',
  'seasons/2025/ladder.json',
  'seasons/2025/matches.json',
];

let db: Db;
let tmp: string;
beforeAll(async () => {
  ({ db } = await buildFixtureDb());
  tmp = await mkdtemp(join(tmpdir(), 'afl-publish-'));
});
afterAll(async () => {
  if (db) closeDb(db);
  await rm(tmp, { recursive: true, force: true });
});

describe('publish (fixture warehouse)', () => {
  it('writes the v1 files and reports them', async () => {
    const outDir = join(tmp, 'golden', 'v1');
    const lines: string[] = [];
    const report = await publish({ conn: db.conn, outDir, log: (l) => lines.push(l) });
    expect(report).toEqual({ seasons: [2003, 2025], files: 10, matches: 5 });
    expect(await listFiles(outDir)).toEqual(EXPECTED_FILES);
    expect(lines.join('\n')).toContain('2025: 4 matches, 2 ladder rounds');
  });

  it.each(EXPECTED_FILES)('matches the golden file %s', async (path) => {
    const text = await readFile(join(tmp, 'golden', 'v1', path), 'utf8');
    await expect(`${JSON.stringify(JSON.parse(text), null, 2)}\n`).toMatchFileSnapshot(
      `./golden/v1/${path}`,
    );
  });

  it('writes byte-identical files when nothing changed', async () => {
    const a = join(tmp, 'a', 'v1');
    const b = join(tmp, 'b', 'v1');
    await publish({ conn: db.conn, outDir: a });
    await publish({ conn: db.conn, outDir: b });
    for (const path of EXPECTED_FILES) {
      expect(await readFile(join(b, path), 'utf8'), path).toBe(
        await readFile(join(a, path), 'utf8'),
      );
    }
  });

  it('removes files that are no longer published', async () => {
    const outDir = join(tmp, 'stale', 'v1');
    await mkdir(join(outDir, 'matches', '2025'), { recursive: true });
    await writeFile(join(outDir, 'matches', '2025', '999999999999.json'), '{}');
    await publish({ conn: db.conn, outDir });
    expect(await listFiles(outDir)).toEqual(EXPECTED_FILES);
  });
});

describe('publish with invalid data', () => {
  it('fails before writing anything, leaving the previous output in place', async () => {
    const { db: broken } = await buildFixtureDb();
    try {
      await exec(broken.conn, "UPDATE match SET venue = '' WHERE match_id = '141820250511'");
      const outDir = join(tmp, 'invalid', 'v1');
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'meta.json'), 'previous');
      await expect(publish({ conn: broken.conn, outDir })).rejects.toThrow(PublishValidationError);
      await expect(publish({ conn: broken.conn, outDir })).rejects.toThrow(
        /matches\/2025\/141820250511\.json is invalid[\s\S]*venue/,
      );
      expect(await listFiles(join(tmp, 'invalid'))).toEqual(['v1/meta.json']);
      expect(await readFile(join(outDir, 'meta.json'), 'utf8')).toBe('previous');
    } finally {
      closeDb(broken);
    }
  });
});
