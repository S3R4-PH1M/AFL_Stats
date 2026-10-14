/**
 * AFL Tables round labels, shared by the season and match page parsers.
 *
 * Season pages head each home-and-away round "Round N" (2025 Round 1 adds a "* see notes" link)
 * and each final with its name. Match pages show "Round: N" or "Round: Grand Final".
 * The numbering is AFL Tables' own: in 2025 its Round 1 is the AFL's Opening Round (Squiggle
 * round 0), so every 2025 round number is one higher than Squiggle's.
 */
import { cleanText } from './decode.ts';

export const FINALS_LABELS = [
  'Qualifying Final',
  'Elimination Final',
  'Semi Final',
  'Preliminary Final',
  'Grand Final',
] as const;

export interface RoundInfo {
  roundLabel: string;
  /** NULL for finals. */
  roundNo: number | null;
  isFinal: boolean;
  isGrandFinal: boolean;
}

export class UnknownRoundError extends Error {
  constructor(raw: string) {
    super(`Unrecognised AFL Tables round label "${raw}"`);
    this.name = 'UnknownRoundError';
  }
}

const HOME_AND_AWAY = /^(?:Round )?([1-9]\d?)(?: \* see notes)?$/;

export function normaliseRound(raw: string): RoundInfo {
  const text = cleanText(raw);
  const finalLabel = FINALS_LABELS.find((label) => label === text);
  if (finalLabel) {
    return {
      roundLabel: finalLabel,
      roundNo: null,
      isFinal: true,
      isGrandFinal: finalLabel === 'Grand Final',
    };
  }
  const roundNo = HOME_AND_AWAY.exec(text)?.[1];
  if (!roundNo) throw new UnknownRoundError(raw);
  return {
    roundLabel: `Round ${roundNo}`,
    roundNo: Number(roundNo),
    isFinal: false,
    isGrandFinal: false,
  };
}
