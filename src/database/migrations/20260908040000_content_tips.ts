import type { Knex } from 'knex';

/**
 * "Tips" (أفضل النصائح) — a structured care-advice type inside the content
 * module. Managed by ADMIN or an approved-vet CONTENT system-supervisor via the
 * existing `content.*` permissions (no new RBAC). Reuses `categories` (FK) and
 * the R2 object-storage convention (cover image = METADATA ONLY).
 *
 * A tip carries the reference-design structure: a summary + read-minutes, a
 * priority flag (IMPORTANT / RECOMMENDED / NORMAL), a "tip of the day" flag,
 * a cover image, and three body sections — intro prose, key points, "when to
 * worry" points, and vet-advice.
 *
 * Engagement: `tip_bookmarks` (save) and `tip_reactions` (helpful) are per-user;
 * `helpful_count` on the tip is a denormalised counter kept in sync by the
 * service inside the same transaction as the reaction write.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('content_tips', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('category_id').nullable().references('id').inTable('categories').onDelete('SET NULL');
    t.text('title').notNullable();
    t.text('summary').nullable();
    t.integer('read_minutes').nullable();
    t.text('priority').notNullable().defaultTo('NORMAL');
    t.boolean('is_tip_of_day').notNullable().defaultTo(false);
    t.text('cover_image_storage_key').nullable();
    t.text('cover_image_storage_provider').nullable();
    t.text('body_intro').nullable();
    t.jsonb('key_points').notNullable().defaultTo('[]');
    t.jsonb('warning_points').notNullable().defaultTo('[]');
    t.text('vet_advice').nullable();
    t.text('status').notNullable().defaultTo('DRAFT');
    t.timestamp('published_at', { useTz: true }).nullable();
    t.integer('helpful_count').notNullable().defaultTo(0);
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `ALTER TABLE content_tips ADD CONSTRAINT chk_content_tips_priority
       CHECK (priority IN ('IMPORTANT', 'RECOMMENDED', 'NORMAL'))`,
  );
  await knex.raw(
    `ALTER TABLE content_tips ADD CONSTRAINT chk_content_tips_status
       CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))`,
  );
  await knex.raw(
    `ALTER TABLE content_tips ADD CONSTRAINT chk_content_tips_title_len
       CHECK (char_length(title) BETWEEN 1 AND 300)`,
  );
  await knex.raw(
    `ALTER TABLE content_tips ADD CONSTRAINT chk_content_tips_read_minutes
       CHECK (read_minutes IS NULL OR read_minutes BETWEEN 1 AND 240)`,
  );
  await knex.raw(
    `ALTER TABLE content_tips ADD CONSTRAINT chk_content_tips_helpful_count
       CHECK (helpful_count >= 0)`,
  );

  // Search: generated tsvector over title + summary + intro (config `simple`,
  // same approach as `contents.search_vector`).
  await knex.raw(`
    ALTER TABLE content_tips ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        to_tsvector(
          'simple',
          coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_intro, '')
        )
      ) STORED
  `);
  await knex.raw(`CREATE INDEX idx_content_tips_search ON content_tips USING gin (search_vector)`);

  // Hot public query: PUBLISHED, newest first.
  await knex.raw(`
    CREATE INDEX idx_content_tips_public ON content_tips (status, published_at DESC)
      WHERE deleted_at IS NULL
  `);
  await knex.raw(`CREATE INDEX idx_content_tips_admin ON content_tips (status, created_at DESC)`);
  await knex.raw(`CREATE INDEX idx_content_tips_category ON content_tips (category_id)`);
  // At most one live "tip of the day".
  await knex.raw(`
    CREATE UNIQUE INDEX uq_content_tips_tip_of_day ON content_tips ((is_tip_of_day))
      WHERE is_tip_of_day = true AND deleted_at IS NULL
  `);

  await knex.schema.createTable('tip_bookmarks', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('tip_id').notNullable().references('id').inTable('content_tips').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'tip_id']);
    t.index('tip_id', 'idx_tip_bookmarks_tip');
  });

  await knex.schema.createTable('tip_reactions', (t) => {
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('tip_id').notNullable().references('id').inTable('content_tips').onDelete('CASCADE');
    t.text('kind').notNullable().defaultTo('HELPFUL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'tip_id']);
    t.index('tip_id', 'idx_tip_reactions_tip');
  });
  await knex.raw(
    `ALTER TABLE tip_reactions ADD CONSTRAINT chk_tip_reactions_kind CHECK (kind IN ('HELPFUL'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tip_reactions');
  await knex.schema.dropTableIfExists('tip_bookmarks');
  await knex.schema.dropTableIfExists('content_tips');
}
