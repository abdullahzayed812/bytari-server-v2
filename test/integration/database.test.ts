import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';
import { createKnex, pingDatabase } from '../../src/database/knex.js';

/**
 * Real-database integration test.
 *
 * Requires a reachable Postgres (`docker compose up -d db`) with migrations
 * applied (`npm run db:migrate`). Verifies connectivity and that the Phase 1
 * baseline migration ran.
 */
describe('database', () => {
  let db: Knex;

  beforeAll(() => {
    db = createKnex(loadConfig());
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('accepts a connection and responds to a ping', async () => {
    await expect(pingDatabase(db)).resolves.toBeUndefined();
  });

  it('has run the knex migration table', async () => {
    const exists = await db.schema.hasTable('knex_migrations');
    expect(exists).toBe(true);
  });

  it('has applied the Phase 1 baseline migration (pgcrypto + citext)', async () => {
    const { rows } = (await db.raw(
      "select extname from pg_extension where extname in ('pgcrypto', 'citext')",
    )) as { rows: { extname: string }[] };
    const names = rows.map((r) => r.extname).sort();
    expect(names).toEqual(['citext', 'pgcrypto']);
  });

  it('can generate a UUID via gen_random_uuid()', async () => {
    const { rows } = (await db.raw('select gen_random_uuid() as id')) as {
      rows: { id: string }[];
    };
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
