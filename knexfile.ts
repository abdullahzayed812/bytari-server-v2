import path from 'node:path';
import type { Knex } from 'knex';
import { loadConfig } from './src/config/index.js';
import { buildKnexConfig } from './src/database/knex-config.js';

/**
 * Knex CLI configuration.
 *
 * - `development` / `test`  → run TypeScript migrations directly via `tsx`.
 * - `production`            → run the compiled `.js` migrations from `dist/`.
 *
 * Connection details come from the same validated {@link loadConfig} used by
 * the application, so there is a single source of truth for DB settings.
 */
const config = loadConfig();

const development: Knex.Config = buildKnexConfig(config, {
  migrationsDir: path.resolve('src/database/migrations'),
  seedsDir: path.resolve('src/database/seeds'),
  extension: 'ts',
});

const production: Knex.Config = buildKnexConfig(config, {
  migrationsDir: path.resolve('dist/database/migrations'),
  seedsDir: path.resolve('dist/database/seeds'),
  extension: 'js',
});

const configs: Record<string, Knex.Config> = {
  development,
  test: development,
  production,
};

export default configs;
