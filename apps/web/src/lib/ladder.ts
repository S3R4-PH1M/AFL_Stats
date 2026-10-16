import type { LadderRow, SeasonLadderFile } from '@afl/core';

export type LadderRound = SeasonLadderFile['rounds'][number];

export interface RoundOption {
  roundNo: number;
  roundLabel: string;
}

/** The rounds with a published ladder, in round order (Opening Round = 0 first). */
export function roundOptions(file: SeasonLadderFile): RoundOption[] {
  return file.rounds.map(({ roundNo, roundLabel }) => ({ roundNo, roundLabel }));
}

/** The requested round's ladder, or the latest round when none (or an unknown one) is asked for. */
export function selectRound(file: SeasonLadderFile, roundNo?: number): LadderRound | undefined {
  return file.rounds.find((r) => r.roundNo === roundNo) ?? file.rounds.at(-1);
}

/** Rows in ladder order. */
export function sortLadder(rows: readonly LadderRow[]): LadderRow[] {
  return [...rows].sort((a, b) => a.rank - b.rank);
}
