import type { MetaFile, SeasonLadderFile, SeasonMatchesFile } from '@afl/core';
import { LadderTable } from '../components/LadderTable.tsx';
import { RoundResults } from '../components/RoundResults.tsx';
import { RoundSelect } from '../components/RoundSelect.tsx';
import { roundOptions, selectRound } from '../lib/ladder.ts';
import { groupByRound, teamNames } from '../lib/matches.ts';

export interface SeasonViewProps {
  year: number;
  meta: MetaFile;
  ladder: SeasonLadderFile;
  matches: SeasonMatchesFile;
  /** From `?round=`; the latest round when undefined. */
  round: number | undefined;
  onRoundChange: (roundNo: number) => void;
}

/** `/season/:year`: the ladder after a chosen round, and every result by round (Q1). */
export function SeasonView({ year, meta, ladder, matches, round, onRoundChange }: SeasonViewProps) {
  const name = teamNames(meta);
  const selected = selectRound(ladder, round);
  const groups = groupByRound(matches.matches);
  return (
    <>
      <h1>{year} season</h1>
      <section aria-labelledby="ladder-heading">
        <h2 id="ladder-heading">Ladder</h2>
        {selected ? (
          <>
            <RoundSelect
              options={roundOptions(ladder)}
              value={selected.roundNo}
              onChange={onRoundChange}
            />
            <LadderTable
              caption={`Ladder after ${selected.roundLabel}`}
              rows={selected.rows}
              name={name}
            />
          </>
        ) : (
          <p>No home-and-away round has been played yet.</p>
        )}
      </section>
      <section aria-labelledby="results-heading">
        <h2 id="results-heading">Results</h2>
        {groups.length > 0 ? (
          groups.map((g) => (
            <RoundResults key={`${g.roundNo} ${g.roundLabel}`} year={year} group={g} name={name} />
          ))
        ) : (
          <p>No results yet.</p>
        )}
      </section>
    </>
  );
}
