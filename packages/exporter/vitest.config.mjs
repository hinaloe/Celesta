import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are TypeScript; `pnpm test` type-checks them first (test/tsconfig.json).
    include: ['test/**/*.test.mts'],
    environment: 'node',
  },
});
