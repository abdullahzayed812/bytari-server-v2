import type { Knex } from 'knex';
import { loadConfig } from '../../src/config/index.js';
import { createKnex } from '../../src/database/knex.js';
import { seed as seedRbac } from '../../src/database/seeds/0010_rbac.js';
import { seed as seedOrgRbac } from '../../src/database/seeds/0030_organization_rbac.js';

let db: Knex | undefined;
let ready: Promise<void> | undefined;

/** Shared test Knex instance. */
export function getTestDb(): Knex {
  db ??= createKnex(loadConfig());
  return db;
}

async function seedCatalogues(knex: Knex): Promise<void> {
  await seedRbac(knex);
  await seedOrgRbac(knex);
}

/**
 * Verify the schema is migrated (`npm test` runs `db:migrate` first) and
 * (re)apply the RBAC + organization-RBAC seed. Runs once per test file.
 */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const knex = getTestDb();
    const migrated =
      (await knex.schema.hasTable('users')) && (await knex.schema.hasTable('organizations'));
    if (!migrated) {
      throw new Error(
        'Test database is not migrated. Run `npm run db:migrate` (the `npm test` script does this automatically).',
      );
    }
    await seedCatalogues(knex);
  })();
  return ready;
}

/**
 * Reset to a clean slate between tests: no users / organizations / sessions /
 * audit rows, and the RBAC catalogues restored to their seeded defaults.
 */
export async function resetDb(): Promise<void> {
  const knex = getTestDb();
  await knex.raw('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
  // `pet_owner_store_categories` / `veterinarian_store_categories` are standalone
  // catalogue tables with no FK to `users`, so the cascade above never reaches
  // them — truncate explicitly so fixed-slug category fixtures start from a
  // clean slate every test.
  await knex.raw('TRUNCATE TABLE pet_owner_store_categories RESTART IDENTITY CASCADE');
  await knex.raw('TRUNCATE TABLE veterinarian_store_categories RESTART IDENTITY CASCADE');
  // `ai_settings` has no FK to `users` (so `TRUNCATE users CASCADE` misses it) and
  // no per-test reset of its own — without this an AI-enable in one suite leaks
  // into every later suite that creates a consultation / inquiry.
  await knex('ai_settings').update({ enabled: false });
  await knex.raw('DELETE FROM role_permissions');
  await knex.raw('DELETE FROM organization_role_permissions');
  await seedCatalogues(knex);
}

export async function closeTestDb(): Promise<void> {
  if (db) await db.destroy();
  db = undefined;
  ready = undefined;
}
