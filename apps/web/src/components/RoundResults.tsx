import type { MatchSide } from '@afl/core';
import { Link } from '@tanstack/react-router';
import { formatScore } from '../lib/format.ts';
import { matchTitle, type RoundGroup, type TeamName } from '../lib/matches.ts';

const score = (s: MatchSide) => formatScore(s.goals, s.behinds, s.score);

export interface RoundResultsProps {
  year: number;
  group: RoundGroup;
  name: TeamName;
}

/** One round's results; each match links to its box score. */
export function RoundResults({ year, group, name }: RoundResultsProps) {
  return (
    <section className="round">
      <h3>{group.roundLabel}</h3>
      <table className="data results">
        <caption className="visually-hidden">{group.roundLabel} results</caption>
        <thead>
          <tr>
            <th scope="col">Match</th>
            <th scope="col" className="num">
              Home
            </th>
            <th scope="col" className="num">
              Away
            </th>
            <th scope="col">Venue</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody>
          {group.matches.map((m) => (
            <tr key={m.matchId}>
              <th scope="row">
                <Link
                  to="/match/$year/$matchId"
                  params={{ year: String(year), matchId: m.matchId }}
                >
                  {matchTitle(m, name)}
                </Link>
              </th>
              <td className={`num${m.home.score > m.away.score ? ' strong' : ''}`}>
                {score(m.home)}
              </td>
              <td className={`num${m.away.score > m.home.score ? ' strong' : ''}`}>
                {score(m.away)}
              </td>
              <td>{m.venue}</td>
              <td>{m.localTime}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
