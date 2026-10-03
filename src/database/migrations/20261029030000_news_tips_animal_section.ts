import type { Knex } from 'knex';

/**
 * Additional corrections §11 — per-section "آخر الأخبار" / "أفضل النصائح":
 * `animal_section` on news + content_tips (PETS | SHEEP | CATTLE | POULTRY, NULL =
 * general). Existing rows stay general (NULL) until an editor assigns them.
 */
const TABLES = ['news', 'content_tips'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const t of TABLES) {
    await knex.schema.alterTable(t, (tb) => {
      tb.text('animal_section').nullable();
    });
    await knex.raw(
      `ALTER TABLE ${t} ADD CONSTRAINT chk_${t}_animal_section CHECK (animal_section IS NULL OR animal_section IN ('PETS','SHEEP','CATTLE','POULTRY'))`,
    );
    await knex.raw(
      `CREATE INDEX idx_${t}_animal_section ON ${t} (animal_section) WHERE animal_section IS NOT NULL`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const t of TABLES) {
    await knex.raw(`DROP INDEX IF EXISTS idx_${t}_animal_section`);
    await knex.raw(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS chk_${t}_animal_section`);
    await knex.schema.alterTable(t, (tb) => {
      tb.dropColumn('animal_section');
    });
  }
}
