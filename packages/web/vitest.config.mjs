import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Browser export loads the ducking curve from source, as vite.config.ts does.
  resolve: { alias: [
    { find: /^@celesta\/media-utils\/duck$/, replacement: fileURLToPath(new URL('../media-utils/src/duck.ts', import.meta.url)) },
  ] },
  test: {
    // New tests are TypeScript; `pnpm test` type-checks them first
    // (test/tsconfig.json). The .mjs tests run under node --test.
    include: ['test/**/*.test.mts'],
    environment: 'node',
  },
});
