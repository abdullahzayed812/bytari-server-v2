import type { Knex } from 'knex';

/**
 * "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" — a viewer's fire-and-forget
 * interaction with a Lost/Adoption/Mating listing. Deliberately NOT a
 * request/response workflow (no accept/reject state machine, no admin
 * moderation) — it just records the interest/report and notifies the
 * publication's owner via the existing Notifications module (Phase 15). The
 * owner follows up directly using the listing's contact info.
 *
 * One row per (publication, user, type) — re-tapping "Request" is a no-op,
 * not a duplicate notification spam vector (service does an upsert).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('animal_publication_interactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('publication_id')
      .notNullable()
      .references('id')
      .inTable('animal_publications')
      .onDelete('CASCADE');
    t.text('type').notNullable();
    t.uuid('requester_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('message').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['publication_id', 'requester_user_id', 'type'], {
      indexName: 'uq_animal_publication_interactions_unique',
    });
    t.index('publication_id', 'idx_animal_publication_interactions_publication');
  });

  await knex.raw(`
    ALTER TABLE animal_publication_interactions
      ADD CONSTRAINT chk_animal_publication_interactions_type
      CHECK (type IN ('REQUEST', 'SIGHTING'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('animal_publication_interactions');
}
