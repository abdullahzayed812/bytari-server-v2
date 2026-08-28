import type { Knex } from 'knex';

/**
 * Phase 4 — Animals & ownership.
 *
 *   animals ──< animal_ownerships (history; exactly one "current" row per animal)
 *
 * Ownership is NOT a column on `animals` — it is a dedicated history table so
 * transfers preserve the full chain. The partial unique index
 * `uq_animal_current_ownership` is the DB-level guarantee that an animal has at
 * most one current owner (a row with `ended_at IS NULL`).
 *
 * Deliberately minimal Animal Core (spec §5/§6): identity + profile fields only.
 * NOT modelled here (future domains): lost / adoption / mating status, medical
 * records, vaccinations, farm/poultry data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('animals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable();
    t.text('species').notNullable();
    t.text('breed').nullable();
    t.text('sex').notNullable().defaultTo('UNKNOWN');
    t.date('date_of_birth').nullable();
    t.text('notes').nullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    // Immutable: the user who first registered the animal (server-set, never from
    // the client). Ownership is tracked separately in `animal_ownerships`.
    t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('deactivated_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('created_by', 'idx_animals_created_by');
    t.index('status', 'idx_animals_status');
  });

  await knex.raw(`
    ALTER TABLE animals
      ADD CONSTRAINT chk_animals_status CHECK (status IN ('ACTIVE', 'DEACTIVATED'))
  `);
  await knex.raw(`
    ALTER TABLE animals
      ADD CONSTRAINT chk_animals_sex CHECK (sex IN ('MALE', 'FEMALE', 'UNKNOWN'))
  `);
  await knex.raw(`
    ALTER TABLE animals
      ADD CONSTRAINT chk_animals_species
      CHECK (species IN ('DOG', 'CAT', 'BIRD', 'RABBIT', 'REPTILE', 'FISH', 'HORSE', 'OTHER'))
  `);

  await knex.schema.createTable('animal_ownerships', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('CASCADE');
    // RESTRICT: a user who owns / has owned an animal cannot be deleted (identity
    // records are never physically deleted anyway — Phase 2 policy).
    t.uuid('owner_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('ended_at', { useTz: true }).nullable();
    // Who performed the action that opened this ownership (creator for the first
    // record; the previous owner or an ADMIN for a transfer).
    t.uuid('transferred_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('transfer_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('owner_user_id', 'idx_animal_ownerships_owner');
    t.index('animal_id', 'idx_animal_ownerships_animal');
  });

  // The core invariant: at most one CURRENT ownership per animal.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_animal_current_ownership
      ON animal_ownerships (animal_id)
      WHERE ended_at IS NULL
  `);
  // A closed ownership must have ended after it started.
  await knex.raw(`
    ALTER TABLE animal_ownerships
      ADD CONSTRAINT chk_animal_ownership_dates
      CHECK (ended_at IS NULL OR ended_at >= started_at)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('animal_ownerships');
  await knex.schema.dropTableIfExists('animals');
}
