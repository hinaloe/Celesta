import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests here start CLI processes, which take several times longer on a
    // busy runner and pass vitest's 5 s default with nothing wrong.
    testTimeout: 30_000,
  },
});
