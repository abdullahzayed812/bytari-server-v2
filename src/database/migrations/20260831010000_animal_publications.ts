import type { Knex } from 'knex';

/**
 * Phase 7 — Animal lifecycle publications: Lost / Adoption / Mating.
 *
 * One table with a `kind` discriminator — the three publication types share an
 * identical approval lifecycle (PENDING → APPROVED / REJECTED, docs 05
 * UC-005/006/007) and the spec defines no type-specific fields. A dedicated
 * table per type would be pure duplication (spec §14 asks for a *reusable*
 * lifecycle).
 *
 * NOT modelled here: animal identity/profile (Phase 4 `animals`), ownership &
 * transfer (Phase 4 `animal_ownerships`), clinic↔animal access (Phase 5
 * `animal_clinic_access`), and anything medical.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('animal_publications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // RESTRICT: a publication keeps the animal reference intact (animals are
    // soft-deactivated, never physically deleted).
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('RESTRICT');
    t.text('kind').notNullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('note').nullable();
    // The publisher — always the animal's CURRENT owner at publish time (server
    // derived, never from the client). This is the safe "ownership context".
    t.uuid('created_by_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    // Moderation metadata — server-controlled only.
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('animal_id', 'idx_animal_publications_animal');
    t.index('created_by_user_id', 'idx_animal_publications_creator');
    t.index(['kind', 'status'], 'idx_animal_publications_kind_status');
    t.index('status', 'idx_animal_publications_status');
  });

  await knex.raw(`
    ALTER TABLE animal_publications
      ADD CONSTRAINT chk_animal_publications_kind
      CHECK (kind IN ('LOST', 'ADOPTION', 'MATING'))
  `);
  await knex.raw(`
    ALTER TABLE animal_publications
      ADD CONSTRAINT chk_animal_publications_status
      CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
  `);
  // A reviewed publication must carry a reviewer + timestamp; a PENDING one must not.
  await knex.raw(`
    ALTER TABLE animal_publications
      ADD CONSTRAINT chk_animal_publications_review
      CHECK (
        (status = 'PENDING'  AND reviewed_by_user_id IS NULL     AND reviewed_at IS NULL)
        OR
        (status <> 'PENDING' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
      )
  `);
  // A rejection reason only exists on a REJECTED publication.
  await knex.raw(`
    ALTER TABLE animal_publications
      ADD CONSTRAINT chk_animal_publications_rejection
      CHECK (status = 'REJECTED' OR rejection_reason IS NULL)
  `);
  // At most one PENDING publication of a kind per animal — stops moderation-queue spam.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_animal_publications_open
      ON animal_publications (animal_id, kind)
      WHERE status = 'PENDING'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('animal_publications');
}
