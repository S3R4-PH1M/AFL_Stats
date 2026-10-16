import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Replaces `outDir` with exactly `entries` ([relative path, text]), so files that are no longer
 * published disappear. Writes into `<outDir>.staging`, moves the old directory aside to
 * `<outDir>.old`, then renames staging into place. If that rename fails (on Windows a dev server
 * or indexer can hold a handle), the old directory is put back, so `outDir` is never left missing.
 * Leftovers from a crashed run are removed first.
 */
export async function writeFiles(
  outDir: string,
  entries: readonly (readonly [path: string, text: string])[],
): Promise<void> {
  const staging = `${outDir}.staging`;
  const old = `${outDir}.old`;
  await rm(staging, { recursive: true, force: true });
  await rm(old, { recursive: true, force: true });

  await mkdir(staging, { recursive: true });
  for (const [path, text] of entries) {
    const target = join(staging, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }

  const hadOld = await rename(outDir, old).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  try {
    await rename(staging, outDir);
  } catch (error) {
    if (hadOld) await rename(old, outDir);
    throw error;
  }
  await rm(old, { recursive: true, force: true });
}
