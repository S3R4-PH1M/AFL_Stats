import type { DuckDBConnection } from '@afl/warehouse';
import { buildFiles, PublishValidationError, serialize } from './files.ts';
import { writeFiles } from './write.ts';

export interface PublishOptions {
  conn: DuckDBConnection;
  /** The `v1` directory, replaced as a whole. */
  outDir: string;
  log?: ((line: string) => void) | undefined;
}

export interface PublishReport {
  seasons: number[];
  files: number;
  matches: number;
}

/**
 * Builds and validates every file, then writes them. Any invalid file fails the run before
 * anything is written, and the error lists every invalid file.
 */
export async function publish({ conn, outDir, log }: PublishOptions): Promise<PublishReport> {
  const { seasons, matches, files } = await buildFiles(conn);
  const entries: [string, string][] = [];
  const failures: PublishValidationError['failures'][number][] = [];
  for (const file of files) {
    try {
      entries.push([file.path, serialize(file)]);
    } catch (error) {
      if (!(error instanceof PublishValidationError)) throw error;
      failures.push(...error.failures);
    }
  }
  if (failures.length > 0) throw new PublishValidationError(failures);

  for (const season of seasons) {
    const ladder = files.find((f) => f.path === `seasons/${season}/ladder.json`);
    const rounds = (ladder?.data as { rounds: unknown[] } | undefined)?.rounds.length ?? 0;
    const count = files.filter((f) => f.path.startsWith(`matches/${season}/`)).length;
    log?.(`  ${season}: ${count} matches, ${rounds} ladder rounds`);
  }
  await writeFiles(outDir, entries);
  return { seasons, files: entries.length, matches };
}
