import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

/** Renders `ui` inside a memory router, so `<Link>`s work in component tests. */
export async function renderWithRouter(ui: ReactNode): Promise<void> {
  const rootRoute = createRootRoute({ component: () => <div data-testid="ready">{ui}</div> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByTestId('ready');
}
