import { getRouteApi } from '@tanstack/react-router';
import { MatchView } from './MatchView.tsx';

const root = getRouteApi('__root__');
const route = getRouteApi('/match/$year/$matchId');

/** Connects `/match/$year/$matchId` to its loader data. */
export function MatchPage() {
  return <MatchView meta={root.useLoaderData()} match={route.useLoaderData()} />;
}
