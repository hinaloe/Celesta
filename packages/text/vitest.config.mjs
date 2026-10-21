import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // New tests are TypeScript; `pnpm test` type-checks them first (test/tsconfig.json).
    include: ['test/**/*.test.mts'],
    environment: 'node',
    server: {
      deps: {
        // dist/ is CommonJS; let Node load it so index.js and the modules the
        // tests import directly (text-measure.js, ...) share one instance.
        external: [/\/dist\//],
      },
    },
  },
});
