import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no scrolling; the router restores scroll on navigation.
vi.stubGlobal('scrollTo', () => {});

afterEach(() => {
  cleanup();
});
