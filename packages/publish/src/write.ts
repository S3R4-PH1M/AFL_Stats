import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Replaces `outDir` with exactly `entries` ([relative path, text]). Writes to a sibling
 * `<outDir>.staging` first, then swaps it in, so files that are no longer published disappear.
 */
export async function writeFiles(
  outDir: string,
  entries: readonly (readonly [path: string, text: string])[],
): Promise<void> {
  const staging = `${outDir}.staging`;
  await rm(staging, { recursive: true, force: true });
  for (const [path, text] of entries) {
    const target = join(staging, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
  await mkdir(staging, { recursive: true });
  await rm(outDir, { recursive: true, force: true });
  await rename(staging, outDir);
}
