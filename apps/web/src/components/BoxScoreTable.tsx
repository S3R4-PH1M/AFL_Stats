import type { MatchDetailSide, MetaFile } from '@afl/core';
import { formatStat } from '../lib/format.ts';

type StatMeta = MetaFile['stats'][number];

/** The stats with at least one value in either box score, in display order. */
export function visibleStats(meta: MetaFile, sides: readonly MatchDetailSide[]): StatMeta[] {
  return [...meta.stats]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .filter((s) =>
      sides.some(
        (side) =>
          side.totals[s.column] !== null || side.players.some((p) => p.stats[s.column] !== null),
      ),
    );
}

const SUB_LABEL = { on: ['↑', 'subbed on'], off: ['↓', 'subbed off'] } as const;

export interface BoxScoreTableProps {
  caption: string;
  side: MatchDetailSide;
  stats: readonly StatMeta[];
}

/** One team's box score: a row per player, then rushed behinds and the page's Totals row. */
export function BoxScoreTable({ caption, side, stats }: BoxScoreTableProps) {
  return (
    <div className="scroll">
      <table className="data box">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Player</th>
            {stats.map((s) => (
              <th key={s.column} scope="col" className="num">
                <abbr title={s.label}>{s.code}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {side.players.map((p) => (
            <tr key={p.playerId}>
              <td className="num">{p.jumper ?? ''}</td>
              <td>
                {p.displayName}
                {p.subStatus && (
                  <>
                    {' '}
                    <span aria-hidden="true">{SUB_LABEL[p.subStatus][0]}</span>
                    <span className="visually-hidden">({SUB_LABEL[p.subStatus][1]})</span>
                  </>
                )}
              </td>
              {stats.map((s) => (
                <td key={s.column} className="num">
                  {formatStat(p.stats[s.column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {side.rushedBehinds > 0 && (
            <tr>
              <th scope="row" colSpan={2}>
                Rushed
              </th>
              {stats.map((s) => (
                <td key={s.column} className="num">
                  {s.column === 'bh' ? side.rushedBehinds : ''}
                </td>
              ))}
            </tr>
          )}
          <tr>
            <th scope="row" colSpan={2}>
              Totals
            </th>
            {stats.map((s) => (
              <td key={s.column} className="num strong">
                {formatStat(side.totals[s.column])}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
