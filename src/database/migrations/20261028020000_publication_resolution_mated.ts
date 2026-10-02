import type { Knex } from 'knex';

/**
 * MATING listings get their own outcome, MATED ("تم التزاوج"), alongside the
 * existing FOUND (LOST) / ADOPTED (ADOPTION) / CLOSED (any) — final corrections §4.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_resolution',
  );
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_resolution CHECK (
      resolution IS NULL OR
      resolution = 'CLOSED' OR
      (resolution = 'FOUND' AND kind = 'LOST') OR
      (resolution = 'ADOPTED' AND kind = 'ADOPTION') OR
      (resolution = 'MATED' AND kind = 'MATING')
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex('animal_publications').where({ resolution: 'MATED' }).update({ resolution: 'CLOSED' });
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_resolution',
  );
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_resolution CHECK (
      resolution IS NULL OR
      resolution = 'CLOSED' OR
      (resolution = 'FOUND' AND kind = 'LOST') OR
      (resolution = 'ADOPTED' AND kind = 'ADOPTION')
    )
  `);
}
