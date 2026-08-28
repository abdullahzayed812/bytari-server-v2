import type { Knex } from 'knex';
import type { AppConfig } from '../config/index.js';

/** Minimal shape of the raw `pg` client handed to knex's `pool.afterCreate`. */
interface PgRawConnection {
  query(sql: string, callback: (err: Error | null) => void): void;
}

/**
 * Translate {@link AppConfig} into a Knex configuration object.
 *
 * `migrationsDir` / `seedsDir` differ between running from TypeScript sources
 * (dev / test, via tsx) and running the compiled build (production).
 */
export function buildKnexConfig(
  config: AppConfig,
  opts: { migrationsDir: string; seedsDir: string; extension: 'ts' | 'js' },
): Knex.Config {
  const { database } = config;

  const ssl = database.ssl ? { rejectUnauthorized: database.sslRejectUnauthorized } : undefined;

  const connection: Knex.PgConnectionConfig = database.url
    ? { connectionString: database.url, ssl }
    : {
        host: database.host,
        port: database.port,
        database: database.name,
        user: database.user,
        password: database.password,
        ssl,
      };

  const timeoutMs = database.statementTimeoutMs;

  return {
    client: 'pg',
    connection,
    pool: {
      min: database.pool.min,
      max: database.pool.max,
      // Bound every statement so one runaway query cannot pin a pool
      // connection forever. Applied once per physical connection.
      afterCreate:
        timeoutMs > 0
          ? (
              conn: PgRawConnection,
              done: (err: Error | null, conn: PgRawConnection) => void,
            ): void => {
              conn.query(`SET statement_timeout = ${timeoutMs}`, (err: Error | null) => {
                done(err, conn);
              });
            }
          : undefined,
    },
    acquireConnectionTimeout: 10_000,
    migrations: {
      directory: opts.migrationsDir,
      extension: opts.extension,
      loadExtensions: [`.${opts.extension}`],
      tableName: 'knex_migrations',
      schemaName: 'public',
      // The same logical migration is authored as `.ts` (dev/test via tsx) and
      // compiled to `.js` (production). knex records the filename *with*
      // extension, so a DB migrated by one runner trips the list-validation of
      // the other. Skip that check — the programmatic runner
      // (`src/database/migrate.ts`) logs exactly what it applies.
      disableMigrationsListValidation: true,
    },
    seeds: {
      directory: opts.seedsDir,
      extension: opts.extension,
      loadExtensions: [`.${opts.extension}`],
    },
  };
}
