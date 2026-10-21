import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mts'],
    environment: 'node',
    // Tests here start CLI processes or run tsc, which take several times
    // longer on a busy runner and pass vitest's 5 s default with nothing wrong.
    testTimeout: 30_000,
  },
});
