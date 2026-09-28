import type { Knex } from 'knex';

/**
 * Admin ↔ user support messages ("تواصل معنا") can now carry image
 * attachments, like consultations / inquiries already do — same presigned R2
 * upload convention, only storage keys persisted (resolved to short-lived
 * signed URLs for thread participants only). Replies in every thread kind may
 * also attach images from now on (see `SupportThreadService.sendMessage`).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('support_thread_messages', (t) => {
    t.specificType('image_keys', 'text[]').notNullable().defaultTo('{}');
  });
  await knex.raw(`
    ALTER TABLE support_thread_messages ADD CONSTRAINT chk_support_thread_messages_image_keys_len
      CHECK (array_length(image_keys, 1) IS NULL OR array_length(image_keys, 1) <= 6)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE support_thread_messages DROP CONSTRAINT IF EXISTS chk_support_thread_messages_image_keys_len',
  );
  await knex.schema.alterTable('support_thread_messages', (t) => {
    t.dropColumn('image_keys');
  });
}
