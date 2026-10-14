/** `--season` validation shared by the `ingest` and `db:build` CLIs. */
import { FIRST_SEASON } from '@afl/core';

export const LAST_SEASON = 2100;

/** The season as a number, or an error message for the user. */
export function parseSeasonArg(value: string | undefined): number | string {
  const season = Number(value);
  if (!value || !/^\d{4}$/.test(value) || season < FIRST_SEASON || season > LAST_SEASON) {
    return (
      `--season must be a year from ${FIRST_SEASON} to ${LAST_SEASON} (got ${value ?? 'nothing'}); ` +
      'earlier seasons need the team lineage from M7'
    );
  }
  return season;
}
