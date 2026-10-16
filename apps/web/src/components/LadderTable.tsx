import type { LadderRow } from '@afl/core';
import { formatPercentage } from '../lib/format.ts';
import { sortLadder } from '../lib/ladder.ts';
import type { TeamName } from '../lib/matches.ts';

const COLUMNS: readonly [label: string, title: string][] = [
  ['P', 'Played'],
  ['W', 'Won'],
  ['L', 'Lost'],
  ['D', 'Drawn'],
  ['PF', 'Points for'],
  ['PA', 'Points against'],
  ['%', 'Percentage'],
  ['Pts', 'Premiership points'],
];

export interface LadderTableProps {
  caption: string;
  rows: readonly LadderRow[];
  name: TeamName;
}

export function LadderTable({ caption, rows, name }: LadderTableProps) {
  return (
    <table className="data">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="num">
            #
          </th>
          <th scope="col">Team</th>
          {COLUMNS.map(([label, title]) => (
            <th key={label} scope="col" className="num">
              <abbr title={title}>{label}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortLadder(rows).map((r) => (
          <tr key={r.teamId}>
            <td className="num">{r.rank}</td>
            <th scope="row">{name(r.teamId)}</th>
            <td className="num">{r.played}</td>
            <td className="num">{r.wins}</td>
            <td className="num">{r.losses}</td>
            <td className="num">{r.draws}</td>
            <td className="num">{r.pointsFor}</td>
            <td className="num">{r.pointsAgainst}</td>
            <td className="num">{formatPercentage(r.percentage)}</td>
            <td className="num strong">{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
