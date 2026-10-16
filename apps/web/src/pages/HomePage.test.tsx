import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithRouter } from '../test/router.tsx';
import { HomeView } from './HomePage.tsx';

describe('HomeView', () => {
  it('renders the heading and links to each season, latest first', async () => {
    await renderWithRouter(<HomeView seasons={[2003, 2025]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'AFL Stats' })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['2025 season', '/season/2025'],
      ['2003 season', '/season/2003'],
    ]);
  });
});
