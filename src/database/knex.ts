import path from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import type { AppConfig } from '../config/index.js';
import { buildKnexConfig } from './knex-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Return PostgreSQL `date` (OID 1082) values as the raw `YYYY-MM-DD` string.
// The default `pg` parser builds a `Date` at the server's LOCAL midnight, which
// then shifts by a day when serialised through `toISOString()` in any non-UTC
// timezone. Date-only columns carry no time/zone, so the string is the correct
// representation everywhere.
pg.types.setTypeParser(1082, (value: string) => value);

/**
 * Create a Knex instance for the running application.
 *
 * Migration/seed directories resolve relative to this module, so it works
 * whether executed from `src/` (tsx) or `dist/` (compiled).
 */
export function createKnex(config: AppConfig): Knex {
  const extension = here.split(path.sep).includes('dist') ? 'js' : 'ts';

  return knexFactory(
    buildKnexConfig(config, {
      migrationsDir: path.join(here, 'migrations'),
      seedsDir: path.join(here, 'seeds'),
      extension,
    }),
  );
}

/** Lightweight connectivity probe used by the readiness check. */
export async function pingDatabase(db: Knex): Promise<void> {
  await db.raw('select 1');
}
