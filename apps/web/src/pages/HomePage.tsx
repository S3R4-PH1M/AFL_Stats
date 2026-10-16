import { Link } from '@tanstack/react-router';

export interface HomeViewProps {
  seasons: readonly number[];
}

/** `/`: a placeholder until the overview page (§11), linking to each published season. */
export function HomeView({ seasons }: HomeViewProps) {
  return (
    <>
      <h1>AFL Stats</h1>
      <p>Team form, player comparisons and all-time records.</p>
      <h2>Seasons</h2>
      <ul className="seasons">
        {[...seasons].reverse().map((year) => (
          <li key={year}>
            <Link to="/season/$year" params={{ year: String(year) }}>
              {year} season
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
