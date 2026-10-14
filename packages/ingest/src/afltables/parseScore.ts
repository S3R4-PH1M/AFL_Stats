/**
 * Cumulative quarter scores → per-quarter scores (proposal §6.4.2, task 9.3).
 *
 * Input is one team's score cells joined by whitespace, e.g. "3.2.20 5.4.34 9.7.61 15.10.100"
 * (match page header) or "4.3. 27  6.4. 40 …". A fifth and later period is extra time.
 */
import { cleanText } from './decode.ts';

export interface QuarterScoreParsed {
  /** 1–4; 5 and above is extra time. */
  quarter: number;
  goals: number;
  behinds: number;
  points: number;
  cumGoals: number;
  cumBehinds: number;
  cumPoints: number;
}

export class ScoreParseError extends Error {
  constructor(message: string, text: string) {
    super(`${message} in score "${text}"`);
    this.name = 'ScoreParseError';
  }
}

const PERIOD = /(\d+)\.(\d+)\.\s*(\d+)/y;

export function parseQuarterScores(text: string): QuarterScoreParsed[] {
  // A literal "&nbsp;" is accepted for raw strings; cheerio text already has U+00A0 instead.
  const input = cleanText(text.replaceAll('&nbsp;', ' '));
  const quarters: QuarterScoreParsed[] = [];
  let pos = 0;
  while (pos < input.length) {
    PERIOD.lastIndex = pos;
    const m = PERIOD.exec(input);
    if (!m) throw new ScoreParseError(`Unexpected text at position ${pos}`, text);
    const [cumGoals, cumBehinds, cumPoints] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (cumPoints !== 6 * cumGoals + cumBehinds) {
      throw new ScoreParseError(`${m[0]}: points ≠ 6 × goals + behinds`, text);
    }
    const prev = quarters.at(-1) ?? { cumGoals: 0, cumBehinds: 0, cumPoints: 0 };
    if (cumGoals < prev.cumGoals || cumBehinds < prev.cumBehinds) {
      throw new ScoreParseError(`${m[0]}: cumulative score decreases`, text);
    }
    quarters.push({
      quarter: quarters.length + 1,
      goals: cumGoals - prev.cumGoals,
      behinds: cumBehinds - prev.cumBehinds,
      points: cumPoints - prev.cumPoints,
      cumGoals,
      cumBehinds,
      cumPoints,
    });
    pos = PERIOD.lastIndex;
    if (pos < input.length) {
      if (input[pos] !== ' ') throw new ScoreParseError(`Unexpected text at position ${pos}`, text);
      pos += 1;
    }
  }
  if (quarters.length < 4) {
    throw new ScoreParseError(`Expected at least 4 periods, found ${quarters.length}`, text);
  }
  return quarters;
}
