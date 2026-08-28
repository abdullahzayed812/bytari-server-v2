import type { Knex } from 'knex';

/**
 * Phase 14 — Content Management.
 *
 * One unified `contents` aggregate (ARTICLE / BOOK / MAGAZINE — docs 04 §4.23)
 * with a DRAFT → PUBLISHED → ARCHIVED lifecycle and project-standard
 * soft-delete (`deleted_at`). Files (book/magazine documents, cover images,
 * article attachments) live in `content_files` as METADATA ONLY — the bytes
 * are in Object Storage (`storage_key`), never in PostgreSQL. Admin-managed
 * `categories` are a lightweight M:N label set (`content_categories`); the
 * specific taxonomy is not in the spec, so none is seeded.
 *
 * Search: a Postgres `GENERATED ... STORED` `tsvector` over title + description
 * with a GIN index (config `simple`, no extension needed) — no unbounded ILIKE.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('slug').notNullable();
    t.text('name').notNullable();
    t.text('description').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE categories ADD CONSTRAINT chk_categories_slug CHECK (slug ~ '^[a-z][a-z0-9-]{0,63}$')`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_categories_slug ON categories (slug) WHERE deleted_at IS NULL`,
  );

  await knex.schema.createTable('contents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('type').notNullable();
    t.text('title').notNullable();
    t.text('description').nullable();
    // Article body — stored VERBATIM as untrusted text (never rendered by the
    // API); size-capped in Zod. HTML/rich-text sanitisation is a future add.
    t.text('body').nullable();
    t.text('author_name').nullable();
    t.text('status').notNullable().defaultTo('DRAFT');
    t.timestamp('published_at', { useTz: true }).nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_type CHECK (type IN ('ARTICLE', 'BOOK', 'MAGAZINE'))`,
  );
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_status
       CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))`,
  );
  await knex.raw(
    `ALTER TABLE contents ADD CONSTRAINT chk_contents_title_len CHECK (char_length(title) BETWEEN 1 AND 300)`,
  );
  await knex.raw(`
    ALTER TABLE contents ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))
      ) STORED
  `);
  await knex.raw(`CREATE INDEX idx_contents_search ON contents USING gin (search_vector)`);
  // The hot public query: PUBLISHED, by type, newest first.
  await knex.raw(`
    CREATE INDEX idx_contents_public ON contents (status, type, published_at DESC)
      WHERE deleted_at IS NULL
  `);
  await knex.raw(`CREATE INDEX idx_contents_admin ON contents (type, status, created_at DESC)`);

  await knex.schema.createTable('content_files', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
    t.text('kind').notNullable();
    t.text('storage_key').notNullable();
    t.text('storage_provider').notNullable();
    t.text('original_filename').notNullable();
    t.text('mime_type').notNullable();
    t.bigInteger('size_bytes').notNullable();
    t.text('checksum').nullable();
    t.uuid('uploaded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('content_id', 'idx_content_files_content');
  });
  await knex.raw(
    `ALTER TABLE content_files ADD CONSTRAINT chk_content_files_kind
       CHECK (kind IN ('MAIN', 'COVER', 'ATTACHMENT'))`,
  );
  await knex.raw(
    `ALTER TABLE content_files ADD CONSTRAINT chk_content_files_size CHECK (size_bytes >= 0)`,
  );
  // At most one live MAIN / COVER file per content item.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_content_files_main ON content_files (content_id)
      WHERE kind = 'MAIN' AND deleted_at IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_content_files_cover ON content_files (content_id)
      WHERE kind = 'COVER' AND deleted_at IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_content_files_key ON content_files (storage_key)
      WHERE deleted_at IS NULL
  `);

  await knex.schema.createTable('content_categories', (t) => {
    t.uuid('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
    t.uuid('category_id').notNullable().references('id').inTable('categories').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['content_id', 'category_id']);
    t.index('category_id', 'idx_content_categories_category');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('content_categories');
  await knex.schema.dropTableIfExists('content_files');
  await knex.schema.dropTableIfExists('contents');
  await knex.schema.dropTableIfExists('categories');
}
