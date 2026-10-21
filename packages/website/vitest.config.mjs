import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tests are TypeScript; `pnpm test` type-checks them first (tests/tsconfig*.json).
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
