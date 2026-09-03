import type { Knex } from 'knex';

/**
 * "نقل ملكية بموافقة" — a request/acceptance ownership-transfer workflow,
 * layered on top of the existing instant `AnimalOwnershipService.transfer()`
 * (spec §4). The current owner proposes a transfer to another user; the
 * animal's ownership only actually moves once that user ACCEPTS. REJECTED /
 * CANCELLED requests never touch ownership.
 *
 * Only one open (PENDING) request per animal at a time — mirrors the
 * `PUBLICATION_ALREADY_OPEN` idiom via a partial unique index.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('animal_transfer_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('animal_id').notNullable().references('id').inTable('animals').onDelete('CASCADE');
    t.uuid('from_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('to_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('reason').nullable();
    t.text('response_reason').nullable();
    t.timestamp('responded_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('animal_id', 'idx_animal_transfer_requests_animal');
    t.index('from_user_id', 'idx_animal_transfer_requests_from_user');
    t.index('to_user_id', 'idx_animal_transfer_requests_to_user');
    t.index('status', 'idx_animal_transfer_requests_status');
  });

  await knex.raw(`
    ALTER TABLE animal_transfer_requests
      ADD CONSTRAINT chk_animal_transfer_requests_status
      CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'))
  `);

  // At most one open request per animal.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_animal_transfer_requests_open
      ON animal_transfer_requests (animal_id)
      WHERE status = 'PENDING'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('animal_transfer_requests');
}
