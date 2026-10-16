import type { MatchDetailFile, MetaFile } from '@afl/core';
import { Link } from '@tanstack/react-router';
import { BoxScoreTable, visibleStats } from '../components/BoxScoreTable.tsx';
import { QuarterTable } from '../components/QuarterTable.tsx';
import { formatAttendance } from '../lib/format.ts';
import { matchTitle, resultText, teamNames } from '../lib/matches.ts';

export interface MatchViewProps {
  meta: MetaFile;
  match: MatchDetailFile;
}

/** `/match/:year/:matchId`: header, scores by quarter and both box scores. */
export function MatchView({ meta, match }: MatchViewProps) {
  const name = teamNames(meta);
  const sides = [match.home, match.away];
  const stats = visibleStats(meta, sides);
  return (
    <>
      <p className="crumb">
        <Link
          to="/season/$year"
          params={{ year: String(match.season) }}
          search={match.roundNo === null ? {} : { round: match.roundNo }}
        >
          {match.season} season
        </Link>
      </p>
      <h1>{matchTitle(match, name)}</h1>
      <p className="meta">
        {match.roundLabel}, {match.season} · {match.venue} · {match.localTime} · Attendance{' '}
        {formatAttendance(match.attendance)}
      </p>
      <p className="result">{resultText(match, name)}</p>
      <QuarterTable sides={sides} name={name} />
      {sides.map((side) => (
        <BoxScoreTable
          key={side.teamId}
          caption={`${name(side.teamId)} box score`}
          side={side}
          stats={stats}
        />
      ))}
    </>
  );
}
