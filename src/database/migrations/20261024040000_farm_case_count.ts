import type { Knex } from 'knex';

/**
 * "عدد الحالات" — an individual-case record can describe several animals with
 * the same presentation (e.g. 12 birds with the same symptoms). Existing rows
 * each described one case, hence DEFAULT 1. The status chips now SUM this.
 */
const TABLES = ['poultry_cases', 'sheep_cases', 'cattle_cases'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.integer('case_count').notNullable().defaultTo(1);
    });
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_case_count CHECK (case_count BETWEEN 1 AND 1000000)`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_case_count`);
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('case_count');
    });
  }
}
