import type { Knex } from 'knex';

/**
 * Image attachments on a CONSULTATION / INQUIRY's initial message (mobile
 * "Create Consultation/Inquiry → Add Images → Submit" flow). Reuses the
 * existing presigned R2 upload convention (`StoragePrefix` in
 * `infra/storage/keys.ts`) — only the storage key array is persisted, never
 * binaries.
 *
 * Deliberately NOT applied to `support_thread_messages` — "تواصل معنا" support
 * messages do not get this capability (see `ThreadKindConfig.maxAttachmentImages`
 * in `application/thread.config.ts`), so that table keeps its original shape.
 */
async function addImageKeysColumn(knex: Knex, table: string): Promise<void> {
  await knex.schema.alterTable(table, (t) => {
    t.specificType('image_keys', 'text[]').notNullable().defaultTo('{}');
  });
  await knex.raw(`
    ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_image_keys_len
      CHECK (array_length(image_keys, 1) IS NULL OR array_length(image_keys, 1) <= 6)
  `);
}

export async function up(knex: Knex): Promise<void> {
  await addImageKeysColumn(knex, 'consultation_messages');
  await addImageKeysColumn(knex, 'inquiry_messages');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE inquiry_messages DROP CONSTRAINT IF EXISTS chk_inquiry_messages_image_keys_len`,
  );
  await knex.schema.alterTable('inquiry_messages', (t) => {
    t.dropColumn('image_keys');
  });
  await knex.raw(
    `ALTER TABLE consultation_messages DROP CONSTRAINT IF EXISTS chk_consultation_messages_image_keys_len`,
  );
  await knex.schema.alterTable('consultation_messages', (t) => {
    t.dropColumn('image_keys');
  });
}
