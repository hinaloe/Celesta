import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are TypeScript; `pnpm test` type-checks them first (test/tsconfig.json).
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // runtime.test.ts stages the runtime, runs tsc and starts the CLI, which
    // take several times longer on a busy runner than vitest's 5 s default.
    testTimeout: 60_000,
    server: {
      deps: {
        // dist/ is CommonJS; let Node load it so index.js and the modules the
        // tests import directly share one instance.
        external: [/\/dist\//],
      },
    },
  },
});
