import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `pnpm test` type-checks the tests first (test/tsconfig.json).
    include: ['test/**/*.test.mts'],
    environment: 'node',
    // Tests here start CLI processes or run tsc, which take several times
    // longer on a busy runner and pass vitest's 5 s default with nothing wrong.
    testTimeout: 30_000,
    server: {
      deps: {
        // dist/ is CommonJS; let Node load it so index.js and the modules the
        // tests import directly (text-measure.js, ...) share one instance.
        external: [/\/dist\//],
      },
    },
  },
});
