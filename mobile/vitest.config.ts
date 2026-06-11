import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Argon2id (64 MiB, t=3) runs twice per interop test — give it room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
