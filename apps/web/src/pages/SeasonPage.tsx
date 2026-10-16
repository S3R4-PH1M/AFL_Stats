import { getRouteApi } from '@tanstack/react-router';
import { SeasonView } from './SeasonView.tsx';

const root = getRouteApi('__root__');
const route = getRouteApi('/season/$year');

/** Connects `/season/$year` to its loader data and the `?round=` search param. */
export function SeasonPage() {
  const meta = root.useLoaderData();
  const { year, ladder, matches } = route.useLoaderData();
  const { round } = route.useSearch();
  const navigate = route.useNavigate();
  return (
    <SeasonView
      year={year}
      meta={meta}
      ladder={ladder}
      matches={matches}
      round={round}
      onRoundChange={(roundNo) =>
        navigate({ search: { round: roundNo }, replace: true, resetScroll: false })
      }
    />
  );
}
