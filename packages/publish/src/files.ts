/**
 * The published files and their validation (proposal §10). Every file is parsed with its core
 * schema before it's written, and the parsed value is what's written, so keys follow schema order.
 */
import { MatchDetailFile, MetaFile, SeasonLadderFile, SeasonMatchesFile } from '@afl/core';
import type { DuckDBConnection } from '@afl/warehouse';
import { queryMatchDetails, queryMeta, querySeasonLadder, querySeasonMatches } from './queries.ts';

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The part of a zod schema publish needs (zod is core's dependency, not publish's). */
export interface FileSchema {
  safeParse(
    data: unknown,
  ): { success: true; data: unknown } | { success: false; error: { issues: readonly Issue[] } };
}

export interface PublishedFile {
  /** Relative to the `v1` directory, `/`-separated. */
  path: string;
  schema: FileSchema;
  data: unknown;
}

const ISSUES_SHOWN = 10;

export class PublishValidationError extends Error {
  constructor(readonly failures: readonly { path: string; issues: readonly Issue[] }[]) {
    const lines = failures.flatMap(({ path, issues }) => [
      `${path} is invalid:`,
      ...issues
        .slice(0, ISSUES_SHOWN)
        .map((i) => `  ${i.path.map(String).join('.') || '(root)'}: ${i.message}`),
      ...(issues.length > ISSUES_SHOWN ? [`  … and ${issues.length - ISSUES_SHOWN} more`] : []),
    ]);
    super(lines.join('\n'));
    this.name = 'PublishValidationError';
  }
}

/** Validates `file` and returns its JSON text: compact, with a trailing newline. */
export function serialize(file: PublishedFile): string {
  const result = file.schema.safeParse(file.data);
  if (!result.success) {
    throw new PublishValidationError([{ path: file.path, issues: result.error.issues }]);
  }
  return `${JSON.stringify(result.data)}\n`;
}

export interface SeasonCounts {
  season: number;
  matches: number;
  ladderRounds: number;
}

export interface BuiltFiles {
  seasons: SeasonCounts[];
  files: PublishedFile[];
}

/** Every `v1` file for the warehouse: meta, then each season's ladder, matches and box scores. */
export async function buildFiles(conn: DuckDBConnection): Promise<BuiltFiles> {
  const meta = await queryMeta(conn);
  const files: PublishedFile[] = [{ path: 'meta.json', schema: MetaFile, data: meta }];
  const seasons: SeasonCounts[] = [];
  for (const season of meta.seasons) {
    const ladder = await querySeasonLadder(conn, season);
    const matches = await querySeasonMatches(conn, season);
    files.push({ path: `seasons/${season}/ladder.json`, schema: SeasonLadderFile, data: ladder });
    files.push({
      path: `seasons/${season}/matches.json`,
      schema: SeasonMatchesFile,
      data: matches,
    });
    for (const detail of await queryMatchDetails(conn, season, matches.matches)) {
      files.push({
        path: `matches/${season}/${detail.matchId}.json`,
        schema: MatchDetailFile,
        data: detail,
      });
    }
    seasons.push({ season, matches: matches.matches.length, ladderRounds: ladder.rounds.length });
  }
  return { seasons, files };
}
