/**
 * Routes, defined in code (decision D4: no router plugin). Each route's loader fetches its `v1`
 * files through `lib/data.ts`; a missing file renders the not-found page. Page components are
 * code-split (§11 performance budget).
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  Link,
  lazyRouteComponent,
  notFound,
  Outlet,
} from '@tanstack/react-router';
import {
  DataNotFoundError,
  getMatch,
  getMeta,
  getSeasonLadder,
  getSeasonMatches,
} from './lib/data.ts';
import { parseRoundSearch, type SeasonSearch } from './lib/ladder.ts';
import { HomeView } from './pages/HomePage.tsx';
import { NotFound } from './pages/NotFound.tsx';

/** A missing data file means the season or match doesn't exist. */
async function orNotFound<T>(load: Promise<T>): Promise<T> {
  try {
    return await load;
  } catch (error) {
    if (error instanceof DataNotFoundError) throw notFound();
    throw error;
  }
}

function parseYear(year: string): number {
  if (!/^\d{4}$/.test(year)) throw notFound();
  return Number(year);
}

const rootRoute = createRootRoute({
  loader: () => getMeta(),
  component: RootLayout,
  errorComponent: RootError,
});

function RootLayout() {
  const meta = rootRoute.useLoaderData();
  const latest = meta.seasons.at(-1);
  return (
    <>
      <header className="site">
        <nav aria-label="Main">
          <Link to="/" className="brand">
            AFL Stats
          </Link>
          {latest !== undefined && (
            <Link to="/season/$year" params={{ year: String(latest) }}>
              {latest} season
            </Link>
          )}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="meta">
        Data as of <time dateTime={meta.dataAsOf}>{meta.dataAsOf.slice(0, 10)}</time> · built{' '}
        <time dateTime={__BUILD_TIME__}>{__BUILD_TIME__.slice(0, 10)}</time> · data from AFL Tables
        and Squiggle
      </footer>
    </>
  );
}

function RootError({ error }: ErrorComponentProps) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>
        {error instanceof DataNotFoundError
          ? 'No data has been published yet.'
          : error instanceof Error
            ? error.message
            : String(error)}
      </p>
      <p>
        <a href={import.meta.env.BASE_URL}>Try again</a>
      </p>
    </main>
  );
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function Home() {
    return <HomeView seasons={rootRoute.useLoaderData().seasons} />;
  },
});

const seasonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/season/$year',
  validateSearch: (search: Record<string, unknown>): SeasonSearch => parseRoundSearch(search.round),
  loader: async ({ params }) => {
    const year = parseYear(params.year);
    const [ladder, matches] = await Promise.all([
      orNotFound(getSeasonLadder(year)),
      orNotFound(getSeasonMatches(year)),
    ]);
    return { year, ladder, matches };
  },
  component: lazyRouteComponent(() => import('./pages/SeasonPage.tsx'), 'SeasonPage'),
});

const matchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/match/$year/$matchId',
  loader: async ({ params }) => {
    const year = parseYear(params.year);
    if (!/^\d{12}$/.test(params.matchId)) throw notFound();
    return orNotFound(getMatch(year, params.matchId));
  },
  component: lazyRouteComponent(() => import('./pages/MatchPage.tsx'), 'MatchPage'),
});

const routeTree = rootRoute.addChildren([homeRoute, seasonRoute, matchRoute]);

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFound,
  defaultPendingComponent: () => <p className="meta">Loading…</p>,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
