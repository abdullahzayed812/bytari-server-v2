import type { Knex } from 'knex';

/**
 * Chat media — one optional attachment (image / video / file) per chat
 * `messages` row. Extends the EXISTING message model (no separate media table
 * or chat system): the attachment is part of the message it was sent with, so
 * it inherits the conversation's access rules, soft delete and realtime event.
 *
 *  - `attachment_storage_key` — private object key, always under
 *    `chat/attachments/<conversationId>/…`; never returned to clients (they get
 *    a short-lived signed URL after the conversation access check). UNIQUE so
 *    one uploaded object can never be linked to a second message.
 *  - all five columns are set together or all NULL (CHECK).
 *  - `body` may now be empty when (and only when) an attachment is present.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('messages', (t) => {
    t.text('attachment_kind').nullable();
    t.text('attachment_storage_key').nullable();
    t.text('attachment_file_name').nullable();
    t.text('attachment_mime_type').nullable();
    t.bigInteger('attachment_size_bytes').nullable();
  });
  await knex.raw(
    `ALTER TABLE messages ADD CONSTRAINT chk_messages_attachment_kind
       CHECK (attachment_kind IS NULL OR attachment_kind IN ('IMAGE', 'VIDEO', 'FILE'))`,
  );
  await knex.raw(
    `ALTER TABLE messages ADD CONSTRAINT chk_messages_attachment_complete
       CHECK (
         (attachment_kind IS NULL AND attachment_storage_key IS NULL AND attachment_file_name IS NULL
            AND attachment_mime_type IS NULL AND attachment_size_bytes IS NULL)
         OR
         (attachment_kind IS NOT NULL AND attachment_storage_key IS NOT NULL
            AND attachment_file_name IS NOT NULL AND attachment_mime_type IS NOT NULL
            AND attachment_size_bytes IS NOT NULL AND attachment_size_bytes > 0)
       )`,
  );
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT chk_messages_body_len`);
  await knex.raw(
    `ALTER TABLE messages ADD CONSTRAINT chk_messages_body_len
       CHECK (
         char_length(body) <= 4000
         AND (char_length(body) >= 1 OR attachment_storage_key IS NOT NULL)
       )`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_messages_attachment_storage_key
       ON messages (attachment_storage_key) WHERE attachment_storage_key IS NOT NULL`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS uq_messages_attachment_storage_key`);
  // Attachment-only messages cannot satisfy the original body rule.
  await knex('messages').where('body', '').update({ body: '[attachment]' });
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT chk_messages_body_len`);
  await knex.raw(
    `ALTER TABLE messages ADD CONSTRAINT chk_messages_body_len
       CHECK (char_length(body) BETWEEN 1 AND 4000)`,
  );
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT chk_messages_attachment_complete`);
  await knex.raw(`ALTER TABLE messages DROP CONSTRAINT chk_messages_attachment_kind`);
  await knex.schema.alterTable('messages', (t) => {
    t.dropColumn('attachment_size_bytes');
    t.dropColumn('attachment_mime_type');
    t.dropColumn('attachment_file_name');
    t.dropColumn('attachment_storage_key');
    t.dropColumn('attachment_kind');
  });
}
