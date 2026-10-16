import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'publish',
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
});
