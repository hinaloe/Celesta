import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // New tests are TypeScript; `pnpm test` type-checks them first
    // (test/tsconfig.json). The .mjs tests run under node --test.
    include: ['test/**/*.test.mts'],
    environment: 'node',
  },
});
