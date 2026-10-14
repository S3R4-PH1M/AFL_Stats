import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'warehouse',
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
});
