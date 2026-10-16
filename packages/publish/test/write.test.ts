import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFiles } from '../src/write.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'afl-write-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('writeFiles', () => {
  it('writes nested files into a new directory', async () => {
    const out = join(dir, 'v1');
    await writeFiles(out, [['seasons/2025/ladder.json', '{}\n']]);
    expect(await readFile(join(out, 'seasons', '2025', 'ladder.json'), 'utf8')).toBe('{}\n');
    expect((await readdir(dir)).sort()).toEqual(['v1']);
  });

  it('replaces the old directory and clears leftovers from a crashed run', async () => {
    const out = join(dir, 'v1');
    await mkdir(join(out, 'old'), { recursive: true });
    await writeFile(join(out, 'old', 'stale.json'), '{}');
    await mkdir(`${out}.staging`, { recursive: true });
    await writeFile(join(`${out}.staging`, 'half.json'), '{');
    await mkdir(`${out}.old`, { recursive: true });
    await writeFiles(out, [['meta.json', '{}\n']]);
    expect(await readdir(out)).toEqual(['meta.json']);
    expect((await readdir(dir)).sort()).toEqual(['v1']);
  });
});
