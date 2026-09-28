import type { Knex } from 'knex';

/**
 * Daily data runs in continuous WEEKLY cycles for the lifetime of a batch —
 * Week 1: Day 1 … Day 7, then Week 2: Day 1 … Day 7, and so on. (Previously a
 * batch stopped accepting daily data after its 7th record.)
 *
 * Each daily record now STORES its batch-relative position:
 *   week_number  — 1, 2, 3 …
 *   day_in_week  — 1 … 7
 * assigned by the server under the batch row lock at insert time. Existing
 * rows are backfilled from their chronological order within the batch. A
 * unique (batch, week, day) index guarantees one record per slot; deleting a
 * record leaves its slot empty (history is never renumbered).
 */
const TABLES = [
  { table: 'poultry_daily_records', fk: 'poultry_flock_id', short: 'poultry' },
  { table: 'sheep_daily_records', fk: 'sheep_batch_id', short: 'sheep' },
  { table: 'cattle_daily_records', fk: 'cattle_batch_id', short: 'cattle' },
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const { table, fk, short } of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.integer('week_number').nullable();
      t.integer('day_in_week').nullable();
    });
    await knex.raw(`
      UPDATE ${table} AS d
         SET week_number = ((s.seq - 1) / 7) + 1,
             day_in_week = ((s.seq - 1) % 7) + 1
        FROM (
          SELECT id,
                 row_number() OVER (PARTITION BY ${fk} ORDER BY record_date ASC, created_at ASC) AS seq
            FROM ${table}
        ) AS s
       WHERE s.id = d.id
    `);
    await knex.schema.alterTable(table, (t) => {
      t.integer('week_number').notNullable().alter();
      t.integer('day_in_week').notNullable().alter();
      t.unique([fk, 'week_number', 'day_in_week'], {
        indexName: `uq_${short}_daily_records_week_day`,
      });
    });
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${short}_daily_records_week_slot
        CHECK (week_number >= 1 AND day_in_week BETWEEN 1 AND 7)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const { table, short } of TABLES) {
    await knex.raw(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${short}_daily_records_week_slot`,
    );
    await knex.raw(`DROP INDEX IF EXISTS uq_${short}_daily_records_week_day`);
    await knex.raw(
      `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS uq_${short}_daily_records_week_day`,
    );
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('week_number');
      t.dropColumn('day_in_week');
    });
  }
}
