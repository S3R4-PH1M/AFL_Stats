import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the heading and build time', () => {
    render(<App buildTime="2026-10-13T00:00:00.000Z" />);
    expect(screen.getByRole('heading', { level: 1, name: 'AFL Stats' })).toBeInTheDocument();
    expect(screen.getByText('2026-10-13T00:00:00.000Z')).toBeInTheDocument();
  });
});
