import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/types/**', 'src/server.ts', 'src/database/migrate.ts'],
    },
    // Integration tests share a DB connection; keep them serial.
    fileParallelism: false,
    // `resetDb()` runs `TRUNCATE ... CASCADE` over the whole schema in a
    // `beforeEach`; on a slow/fsync-bound disk that grows past the 10s default
    // as the schema does. Give hooks headroom so the reset is never the flake.
    // The same disk makes each HTTP round-trip ~3s, so multi-request integration
    // tests need more than the 5s per-test default too.
    hookTimeout: 45_000,
    testTimeout: 30_000,
  },
});
