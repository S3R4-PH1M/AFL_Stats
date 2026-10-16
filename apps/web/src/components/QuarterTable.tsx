import type { MatchSide } from '@afl/core';
import { formatScore } from '../lib/format.ts';
import type { TeamName } from '../lib/matches.ts';

/** Q1–Q4, then "ET" (or ET1, ET2… when there was more than one extra-time period). */
function quarterLabel(quarter: number, last: number): string {
  if (quarter <= 4) return `Q${quarter}`;
  return last > 5 ? `ET${quarter - 4}` : 'ET';
}

export interface QuarterTableProps {
  sides: readonly MatchSide[];
  name: TeamName;
}

/** Cumulative goals.behinds at the end of each quarter, then the final score. */
export function QuarterTable({ sides, name }: QuarterTableProps) {
  const last = Math.max(4, ...sides.flatMap((s) => s.quarters.map((q) => q.quarter)));
  const quarters = Array.from({ length: last }, (_, i) => i + 1);
  return (
    <table className="data">
      <caption>Scores by quarter</caption>
      <thead>
        <tr>
          <th scope="col">Team</th>
          {quarters.map((q) => (
            <th key={q} scope="col" className="num">
              {quarterLabel(q, last)}
            </th>
          ))}
          <th scope="col" className="num">
            Final
          </th>
        </tr>
      </thead>
      <tbody>
        {sides.map((s) => {
          const byQuarter = new Map(s.quarters.map((q) => [q.quarter, q]));
          return (
            <tr key={s.teamId}>
              <th scope="row">{name(s.teamId)}</th>
              {quarters.map((n) => {
                const q = byQuarter.get(n);
                return (
                  <td key={n} className="num">
                    {q ? `${q.cumGoals}.${q.cumBehinds}` : ''}
                  </td>
                );
              })}
              <td className="num strong">{formatScore(s.goals, s.behinds, s.score)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
