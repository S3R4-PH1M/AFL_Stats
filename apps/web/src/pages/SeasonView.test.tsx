import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../test/router.tsx';
import { ladder, matches, meta } from '../test/sample.ts';
import { SeasonView } from './SeasonView.tsx';

const view = (round?: number, onRoundChange = vi.fn()) =>
  renderWithRouter(
    <SeasonView
      year={2025}
      meta={meta}
      ladder={ladder}
      matches={matches}
      round={round}
      onRoundChange={onRoundChange}
    />,
  );

describe('SeasonView', () => {
  it('shows the ladder after the latest round by default, as a table', async () => {
    await view();
    expect(screen.getByRole('heading', { level: 1, name: '2025 season' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Ladder after Round 1' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['#', 'Team', 'P', 'W', 'L', 'D', 'PF', 'PA', '%', 'Pts']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Richmond',
      'Adelaide',
      'Essendon',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('102.53')).toBeInTheDocument();
  });

  it('shows the Opening Round ladder, with a dash for a team yet to play', async () => {
    await view(0);
    const table = screen.getByRole('table', { name: 'Ladder after Opening Round' });
    const richmond = within(table).getByRole('row', { name: /Richmond/ });
    expect(within(richmond).getByText('–')).toBeInTheDocument();
  });

  it('offers every published round and reports a change', async () => {
    const onRoundChange = vi.fn();
    await view(undefined, onRoundChange);
    const select = screen.getByRole('combobox', { name: 'Ladder after' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Opening Round', 'Round 1']);
    expect(select).toHaveValue('1');
    fireEvent.change(select, { target: { value: '0' } });
    expect(onRoundChange).toHaveBeenCalledWith(0);
  });

  it('lists results by round, finals included, each linking to its match', async () => {
    await view();
    const results = screen.getByRole('region', { name: 'Results' });
    expect(
      within(results)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Opening Round', 'Round 1', 'Grand Final']);
    const link = within(results).getByRole('link', { name: 'Richmond v West Coast' });
    expect(link).toHaveAttribute('href', '/match/2025/141820250511');
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('11.15 (81)')).toBeInTheDocument();
    expect(within(row).getByText('11.13 (79)')).toBeInTheDocument();
  });

  it('says so when no ladder round is published yet', async () => {
    await renderWithRouter(
      <SeasonView
        year={2026}
        meta={meta}
        ladder={{ season: 2026, rounds: [] }}
        matches={{ season: 2026, matches: [] }}
        round={undefined}
        onRoundChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No home-and-away round has been played yet.')).toBeInTheDocument();
    expect(screen.getByText('No results yet.')).toBeInTheDocument();
  });
});
