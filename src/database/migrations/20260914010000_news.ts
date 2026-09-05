import type { Knex } from 'knex';

/**
 * "News" (آخر الأخبار) — a general news type inside the content module, the
 * same shape as "Tips": managed by ADMIN or an approved-vet CONTENT
 * system-supervisor via the existing `content.*` permissions (no new RBAC),
 * reusing `categories` (FK) and the R2 object-storage convention (cover image
 * + attached-photo gallery = METADATA ONLY).
 *
 * A news item carries the reference-design structure of the news-detail screen:
 * a summary, an optional source, a "featured" flag ("خبر مميز"), a badge tag
 * (URGENT / IMPORTANT_ALERT), a cover image, prose body, two bulleted sections
 * (reasons / advice), a highlighted alert note, and an attached-photo gallery.
 *
 * Engagement: `news_bookmarks` (save) is per-user; `bookmark_count` on the item
 * is a denormalised counter kept in sync by the service in the same
 * transaction as the bookmark write.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('news', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('category_id').nullable().references('id').inTable('categories').onDelete('SET NULL');
    t.text('title').notNullable();
    t.text('summary').nullable();
    t.text('source').nullable();
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.text('tag').notNullable().defaultTo('NORMAL');
    t.text('cover_image_storage_key').nullable();
    t.text('cover_image_storage_provider').nullable();
    t.text('body').nullable();
    t.jsonb('reason_points').notNullable().defaultTo('[]');
    t.jsonb('advice_points').notNullable().defaultTo('[]');
    t.text('alert_note').nullable();
    t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('DRAFT');
    t.timestamp('published_at', { useTz: true }).nullable();
    t.integer('bookmark_count').notNullable().defaultTo(0);
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `ALTER TABLE news ADD CONSTRAINT chk_news_status
       CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))`,
  );
  await knex.raw(
    `ALTER TABLE news ADD CONSTRAINT chk_news_tag
       CHECK (tag IN ('NORMAL', 'URGENT', 'IMPORTANT_ALERT'))`,
  );
  await knex.raw(
    `ALTER TABLE news ADD CONSTRAINT chk_news_title_len CHECK (char_length(title) BETWEEN 1 AND 300)`,
  );
  await knex.raw(
    `ALTER TABLE news ADD CONSTRAINT chk_news_bookmark_count CHECK (bookmark_count >= 0)`,
  );

  // Search: generated tsvector over title + summary + body (config `simple`,
  // same approach as `contents.search_vector` / `content_tips.search_vector`).
  await knex.raw(`
    ALTER TABLE news ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        to_tsvector(
          'simple',
          coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '')
        )
      ) STORED
  `);
  await knex.raw(`CREATE INDEX idx_news_search ON news USING gin (search_vector)`);

  // Hot public query: PUBLISHED, featured-first, newest first.
  await knex.raw(`
    CREATE INDEX idx_news_public ON news (status, is_featured DESC, published_at DESC)
      WHERE deleted_at IS NULL
  `);
  await knex.raw(`CREATE INDEX idx_news_admin ON news (status, created_at DESC)`);
  await knex.raw(`CREATE INDEX idx_news_category ON news (category_id)`);

  await knex.schema.createTable('news_bookmarks', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('news_id').notNullable().references('id').inTable('news').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'news_id']);
    t.index('news_id', 'idx_news_bookmarks_news');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('news_bookmarks');
  await knex.schema.dropTableIfExists('news');
}
