import { describe, expect, it } from 'vitest';
import { PlayerMatchRow, StatValues } from '../src/schemas.ts';
import { STAT_COLUMNS, STAT_DEFINITIONS } from '../src/stats.ts';

/** `player_match` stat columns from proposal §7. */
const SECTION_7_COLUMNS =
  'ki mk hb di gl bh ho tk rb if50 cl cg ff fa br cp up cm mi one_pct bo ga pct_played';

/** Match Statistics headings after `#` and `Player` (§6.2). */
const AFL_TABLES_CODES = 'KI MK HB DI GL BH HO TK RB IF CL CG FF FA BR CP UP CM MI 1% BO GA %P';

const columns = SECTION_7_COLUMNS.split(' ');

describe('stat definitions', () => {
  it('has 23 unique codes and columns matching §6.2 and §7', () => {
    expect(STAT_DEFINITIONS).toHaveLength(23);
    expect(STAT_DEFINITIONS.map((s) => s.code)).toEqual(AFL_TABLES_CODES.split(' '));
    expect(STAT_DEFINITIONS.map((s) => s.column)).toEqual(columns);
    expect([...STAT_COLUMNS]).toEqual(columns);
  });

  it('has sequential display order and full coverage from 2003', () => {
    expect(STAT_DEFINITIONS.map((s) => s.displayOrder)).toEqual(
      Array.from({ length: 23 }, (_, i) => i + 1),
    );
    for (const s of STAT_DEFINITIONS) expect(s.firstSeason).toBeLessThanOrEqual(2003);
    const byCode = (code: string) => STAT_DEFINITIONS.find((s) => s.code === code);
    expect(byCode('GA')?.firstSeason).toBe(2003);
    expect(byCode('%P')?.firstSeason).toBe(2003);
  });

  it('marks only clangers and free kicks against as lower-is-better', () => {
    expect(STAT_DEFINITIONS.filter((s) => !s.higherIsBetter).map((s) => s.code)).toEqual([
      'CG',
      'FA',
    ]);
  });

  it('keeps the row schemas in step with the stat list', () => {
    expect(Object.keys(StatValues.shape)).toEqual(columns);
    expect(Object.keys(PlayerMatchRow.shape).slice(5)).toEqual(columns);
  });
});
