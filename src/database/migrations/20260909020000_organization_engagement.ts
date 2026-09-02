import type { Knex } from 'knex';

/**
 * Pet Owner engagement on a public organization profile — the Clinic Details
 * screen's "متابعة" (follow) button and "التقييمات" (ratings & reviews) card.
 * Neither existed anywhere in the product before (no likes/ratings system of
 * any kind — see `ClinicCard.tsx`'s note on this); both are new, minimal
 * tables, generic over ANY organization (not CLINIC-only — a follow/review is
 * a relationship between a user and an organization, same shape regardless of
 * type).
 *
 * `organization_follows` is a plain join row — one per (organization, user),
 * no extra state. `organization_reviews` is one row per (organization, user)
 * too: a user reviews an organization once and can update it (no review
 * history / edit trail — matches the simplicity of the rest of the directory
 * profile). Average rating and count are computed at query time; not worth a
 * materialized counter at this volume.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organization_follows', (t) => {
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.primary(['organization_id', 'user_id']);
    t.index('organization_id', 'idx_organization_follows_org');
    t.index('user_id', 'idx_organization_follows_user');
  });

  await knex.schema.createTable('organization_reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('rating').notNullable();
    t.text('comment').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['organization_id', 'user_id'], { indexName: 'uq_organization_reviews_org_user' });
    t.index('organization_id', 'idx_organization_reviews_org');
  });

  await knex.raw(
    `ALTER TABLE organization_reviews ADD CONSTRAINT chk_organization_reviews_rating CHECK (rating BETWEEN 1 AND 5)`,
  );
  await knex.raw(
    `ALTER TABLE organization_reviews ADD CONSTRAINT chk_organization_reviews_comment_len CHECK (comment IS NULL OR char_length(comment) <= 1000)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('organization_reviews');
  await knex.schema.dropTableIfExists('organization_follows');
}
