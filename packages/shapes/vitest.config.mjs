import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    // Every test spawns CLI processes; files racing each other for the CPU
    // push the slower ones past the timeout.
    fileParallelism: false,
    server: {
      deps: {
        // dist/ is CommonJS; let Node load it so index.js and the modules the
        // tests import directly (text-measure.js, ...) share one instance.
        external: [/\/dist\//],
      },
    },
  },
});
