import type { Knex } from 'knex';

/**
 * Veterinary Magazine (`contents.type = 'MAGAZINE'`) & Veterinary Books
 * (`type = 'BOOK'`) — reuses the existing `contents`/`content_files`/
 * `categories` aggregate from `20260904010000_content.ts` (no new catalogue
 * table). This migration adds:
 *
 *   1. Book-only descriptive fields directly on `contents` (same "extend the
 *      column, never a new table" philosophy as the rest of the schema) —
 *      `language` / `page_count` / `publish_year`. Nullable and meaningless
 *      for ARTICLE/MAGAZINE, exactly like `pet_owner_store_products`' detail
 *      fields are meaningless for some product types.
 *   2. Denormalised counters for cheap card-list rendering — `like_count` /
 *      `comment_count` / `view_count` — maintained transactionally by the
 *      service alongside the row that actually changes the count (mirrors
 *      `content_tips.helpful_count`).
 *   3. `content_bookmarks` / `content_likes` — one row per (user, content),
 *      idempotent toggle tables, identical shape to `tip_bookmarks` /
 *      `tip_reactions` (a single implicit reaction kind here, so no `kind`
 *      column).
 *   4. `content_comments` — a flat (no threading/replies — none is shown in
 *      the reference UI), soft-deletable comment list per content item.
 *   5. `content_ratings` — a 1-5 star rating, one per (content, user),
 *      resubmit = upsert, identical shape to `organization_reviews` minus the
 *      free-text comment (books show stars only). The aggregate (average +
 *      count) is computed at query time, not stored, matching
 *      `organization_reviews`' documented choice at this data volume.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('contents', (t) => {
    t.text('language').nullable();
    t.integer('page_count').nullable();
    t.integer('publish_year').nullable();
    t.integer('like_count').notNullable().defaultTo(0);
    t.integer('comment_count').notNullable().defaultTo(0);
    t.integer('view_count').notNullable().defaultTo(0);
  });
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_page_count CHECK (page_count IS NULL OR page_count > 0)`,
  );
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_publish_year
       CHECK (publish_year IS NULL OR publish_year BETWEEN 1900 AND 2100)`,
  );
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_like_count CHECK (like_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_comment_count CHECK (comment_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_view_count CHECK (view_count >= 0)`,
  );

  await knex.schema.createTable('content_bookmarks', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'content_id']);
  });

  await knex.schema.createTable('content_likes', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'content_id']);
  });

  await knex.schema.createTable('content_comments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('body').notNullable();
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['content_id', 'created_at'], 'idx_content_comments_content_created');
  });
  await knex.raw(
    `ALTER TABLE content_comments ADD CONSTRAINT chk_content_comments_body_len
       CHECK (char_length(body) BETWEEN 1 AND 2000)`,
  );

  await knex.schema.createTable('content_ratings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('rating').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['content_id', 'user_id'], { indexName: 'uq_content_ratings_content_user' });
  });
  await knex.raw(
    `ALTER TABLE content_ratings ADD CONSTRAINT chk_content_ratings_value CHECK (rating BETWEEN 1 AND 5)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('content_ratings');
  await knex.schema.dropTableIfExists('content_comments');
  await knex.schema.dropTableIfExists('content_likes');
  await knex.schema.dropTableIfExists('content_bookmarks');
  await knex.raw(`ALTER TABLE contents DROP CONSTRAINT IF EXISTS chk_contents_view_count`);
  await knex.raw(`ALTER TABLE contents DROP CONSTRAINT IF EXISTS chk_contents_comment_count`);
  await knex.raw(`ALTER TABLE contents DROP CONSTRAINT IF EXISTS chk_contents_like_count`);
  await knex.raw(`ALTER TABLE contents DROP CONSTRAINT IF EXISTS chk_contents_publish_year`);
  await knex.raw(`ALTER TABLE contents DROP CONSTRAINT IF EXISTS chk_contents_page_count`);
  await knex.schema.alterTable('contents', (t) => {
    t.dropColumn('view_count');
    t.dropColumn('comment_count');
    t.dropColumn('like_count');
    t.dropColumn('publish_year');
    t.dropColumn('page_count');
    t.dropColumn('language');
  });
}
