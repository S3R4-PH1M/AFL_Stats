import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { parseQuarterScores, ScoreParseError } from '../src/afltables/parseScore.ts';
import { readAfltables } from './helpers.ts';

describe('parseQuarterScores', () => {
  it('turns cumulative scores into per-quarter scores', () => {
    expect(parseQuarterScores('3.2.20 5.4.34 9.7.61 15.10.100')).toEqual([
      { quarter: 1, goals: 3, behinds: 2, points: 20, cumGoals: 3, cumBehinds: 2, cumPoints: 20 },
      { quarter: 2, goals: 2, behinds: 2, points: 14, cumGoals: 5, cumBehinds: 4, cumPoints: 34 },
      { quarter: 3, goals: 4, behinds: 3, points: 27, cumGoals: 9, cumBehinds: 7, cumPoints: 61 },
      {
        quarter: 4,
        goals: 6,
        behinds: 3,
        points: 39,
        cumGoals: 15,
        cumBehinds: 10,
        cumPoints: 100,
      },
    ]);
  });

  it('accepts the spaced "G.B. Pts" form with &nbsp; and irregular whitespace', () => {
    const spaced = parseQuarterScores('4.3. 27  6.4. 40  11.5.\t71 \n11.10.  76');
    expect(spaced.map((q) => q.cumPoints)).toEqual([27, 40, 71, 76]);
    expect(spaced.map((q) => q.points)).toEqual([27, 13, 31, 5]);
    expect(parseQuarterScores('&nbsp;4.3.27&nbsp;6.4.40 11.5.71 11.10.76')).toEqual(spaced);
  });

  it('handles a scoreless quarter', () => {
    const carlton2003 = parseQuarterScores('3.5.23 3.5.23 4.8.32 7.8.50');
    expect(carlton2003[1]).toMatchObject({ goals: 0, behinds: 0, points: 0, cumPoints: 23 });
  });

  it('treats a fifth and later column as extra time', () => {
    const quarters = parseQuarterScores('2.3.15 5.5.35 8.8.56 10.10.70 11.10.76 11.12.78');
    expect(quarters.map((q) => q.quarter)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(quarters[4]).toMatchObject({ goals: 1, behinds: 0, points: 6 });
    expect(quarters[5]).toMatchObject({ goals: 0, behinds: 2, points: 2, cumPoints: 78 });
  });

  it.each([
    ['points ≠ 6·goals + behinds', '3.2.21 5.4.34 9.7.61 15.10.100'],
    ['decreasing goals', '3.2.20 2.4.16 9.7.61 15.10.100'],
    ['decreasing behinds', '3.2.20 5.1.31 9.7.61 15.10.100'],
    ['empty input', ''],
    ['only whitespace', '   '],
    ['garbage', 'abc'],
    ['trailing text', '3.2.20 5.4.34 9.7.61 15.10.100 won'],
    ['fewer than four periods', '3.2.20 5.4.34 9.7.61'],
    ['season-page G.B form without points', '4.3 6.4 11.5 11.10'],
  ])('throws on %s', (_, text) => {
    expect(() => parseQuarterScores(text)).toThrow(ScoreParseError);
  });
});

/** Header score strings, read from each fixture's score table the way the match parser does. */
function headerScoreStrings(fixture: string): { team: string; text: string }[] {
  const $ = load(readAfltables(`${fixture}.html`));
  const header = $('table')
    .filter((_, t) => $(t).find('b').first().text() === 'Round: ')
    .first();
  return header
    .find('tr')
    .filter((_, tr) => $(tr).find('td').first().find('a[href*="/teams/"]').length > 0)
    .map((_, tr) => {
      const cells = $(tr).children('td');
      return {
        team: cells.first().text(),
        text: cells
          .slice(1)
          .map((__, td) => $(td).text())
          .get()
          .join(' '),
      };
    })
    .get();
}

describe('parseQuarterScores on every match fixture', () => {
  // Final scores from fixtures/README.md (2003 from the page header).
  it.each([
    ['2025-141820250511', 'Richmond', [11, 15, 81], 'West Coast', [11, 13, 79]],
    ['2025-010520250322', 'Essendon', [15, 10, 100], 'Adelaide', [25, 11, 161]],
    ['2025-091920250927', 'Geelong', [11, 9, 75], 'Brisbane Lions', [18, 14, 122]],
    ['2025-121920250511', 'North Melbourne', [10, 11, 71], 'Brisbane Lions', [10, 11, 71]],
    ['2003-010320030629', 'Carlton', [7, 8, 50], 'Adelaide', [13, 14, 92]],
  ])('%s: %s v %s', (fixture, home, homeFinal, away, awayFinal) => {
    const strings = headerScoreStrings(fixture);
    expect(strings.map((s) => s.team)).toEqual([home, away]);
    for (const [i, expected] of [homeFinal, awayFinal].entries()) {
      const quarters = parseQuarterScores(strings[i]?.text ?? '');
      expect(quarters).toHaveLength(4);
      const last = quarters.at(-1);
      expect([last?.cumGoals, last?.cumBehinds, last?.cumPoints]).toEqual(expected);
      const sum = (key: 'goals' | 'behinds' | 'points') =>
        quarters.reduce((total, q) => total + q[key], 0);
      expect([sum('goals'), sum('behinds'), sum('points')]).toEqual(expected);
    }
  });
});
