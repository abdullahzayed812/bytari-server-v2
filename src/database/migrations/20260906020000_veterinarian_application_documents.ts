import type { Knex } from 'knex';

/**
 * Mobile Auth & Registration — veterinarian applications gain a `sub_type`
 * (VETERINARIAN vs STUDENT) and supporting identity documents. Documents are
 * METADATA ONLY (`storage_key`) — the bytes live in Object Storage, uploaded
 * via the same presigned-URL flow as `content_files` (§ ARCHITECTURE.md §7.4).
 *
 * Soft delete (`deleted_at`) keeps re-applications independent: a rejected
 * application's documents stay tied to it, untouched by a later re-apply.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('veterinarian_applications', (t) => {
    t.text('sub_type').notNullable().defaultTo('VETERINARIAN');
  });
  await knex.raw(
    `ALTER TABLE veterinarian_applications ADD CONSTRAINT chk_veterinarian_applications_sub_type
       CHECK (sub_type IN ('VETERINARIAN', 'STUDENT'))`,
  );

  await knex.schema.createTable('veterinarian_application_documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('application_id')
      .notNullable()
      .references('id')
      .inTable('veterinarian_applications')
      .onDelete('CASCADE');
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

    t.index('application_id', 'idx_vet_app_documents_application');
  });
  await knex.raw(`
    ALTER TABLE veterinarian_application_documents ADD CONSTRAINT chk_vet_app_documents_kind
      CHECK (kind IN ('LICENSE_OR_ID', 'ADDITIONAL_ID', 'STUDENT_ID_FRONT', 'STUDENT_ID_BACK'))
  `);
  await knex.raw(`
    ALTER TABLE veterinarian_application_documents ADD CONSTRAINT chk_vet_app_documents_size
      CHECK (size_bytes >= 0)
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_vet_app_documents_kind ON veterinarian_application_documents
      (application_id, kind) WHERE deleted_at IS NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_vet_app_documents_key ON veterinarian_application_documents
      (storage_key) WHERE deleted_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('veterinarian_application_documents');
  await knex.schema.alterTable('veterinarian_applications', (t) => {
    t.dropColumn('sub_type');
  });
}
