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
  },
});
