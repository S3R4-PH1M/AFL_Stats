import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithRouter } from '../test/router.tsx';
import { matchDetail, meta } from '../test/sample.ts';
import { MatchView } from './MatchView.tsx';

describe('MatchView', () => {
  it('shows the header with round, venue, attendance and result', async () => {
    await renderWithRouter(<MatchView meta={meta} match={matchDetail} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Richmond v West Coast' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Round 1, 2025/)).toBeInTheDocument();
    expect(screen.getByText(/M\.C\.G\./)).toBeInTheDocument();
    expect(screen.getByText(/29,539/)).toBeInTheDocument();
    expect(screen.getByText('Richmond won by 2 points')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '2025 season' })).toHaveAttribute(
      'href',
      '/season/2025?round=1',
    );
  });

  it('shows cumulative scores by quarter, with an extra-time column', async () => {
    await renderWithRouter(<MatchView meta={meta} match={matchDetail} />);
    const table = screen.getByRole('table', { name: 'Scores by quarter' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Team', 'Q1', 'Q2', 'Q3', 'Q4', 'ET', 'Final']);
    const richmond = within(table).getByRole('row', { name: /Richmond/ });
    expect(
      within(richmond)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['3.4', '6.8', '8.12', '11.15', '12.15', '11.15 (81)']);
    // The sample has no extra-time quarter for West Coast, so its ET cell is blank.
    const westCoast = within(table).getByRole('row', { name: /West Coast/ });
    expect(within(westCoast).getAllByRole('cell')[4]?.textContent).toBe('');
  });

  it('shows both box scores, hiding stats with no values in this match', async () => {
    await renderWithRouter(<MatchView meta={meta} match={matchDetail} />);
    const home = screen.getByRole('table', { name: 'Richmond box score' });
    expect(screen.getByRole('table', { name: 'West Coast box score' })).toBeInTheDocument();
    const headers = within(home)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['#', 'Player', 'KI', 'DI', 'GL', 'BH', '%P']);
    const lynch = within(home).getByRole('row', { name: /Tom Lynch/ });
    expect(
      within(lynch)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['19', 'Tom Lynch', '10', '14', '3', '2', '80']);
    expect(within(home).getByRole('row', { name: /Sub Player/ })).toHaveTextContent('subbed on');
  });

  it('ends each box score with rushed behinds and the Totals row', async () => {
    await renderWithRouter(<MatchView meta={meta} match={matchDetail} />);
    const home = screen.getByRole('table', { name: 'Richmond box score' });
    const rushed = within(home).getByRole('row', { name: /Rushed/ });
    expect(
      within(rushed)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['', '', '', '4', '']);
    const totals = within(home).getByRole('row', { name: /Totals/ });
    expect(
      within(totals)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['12', '17', '3', '6', '–']);
  });
});
