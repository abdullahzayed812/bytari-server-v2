import type { Knex } from 'knex';

/**
 * Phase 15 — Notifications & Firebase FCM.
 *
 * The push *infrastructure* (provider abstraction, `FirebasePushProvider`,
 * `PushNotificationService`, `PushEventBridge`, Firebase config + fail-fast
 * validation) shipped in Phase 1 (`src/infra/push/`). This phase adds the
 * PostgreSQL persistence that the `DeviceTokenRepository` port was waiting on,
 * plus the in-app `notifications` store and per-user `notification_preferences`.
 *
 * In-app notifications are the SOURCE OF TRUTH — FCM / realtime are extra
 * delivery channels whose failure never removes a notification row.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('device_push_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('token').notNullable();
    t.text('platform').notNullable();
    t.text('device_id').nullable();
    t.text('app_version').nullable();
    t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One row per FCM token globally — re-registering moves ownership /
    // refreshes `last_seen_at` and clears `revoked_at` (upsert on `token`).
    t.unique(['token'], { indexName: 'uq_device_push_tokens_token' });
    t.index(['user_id'], 'idx_device_push_tokens_user');
  });
  await knex.raw(
    `ALTER TABLE device_push_tokens ADD CONSTRAINT chk_device_push_tokens_platform
       CHECK (platform IN ('ios', 'android', 'web'))`,
  );

  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('recipient_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('type').notNullable();
    t.text('title').notNullable();
    t.text('body').notNullable();
    // Safe structured navigation metadata only — never secrets / tokens / URLs.
    t.jsonb('data').notNullable().defaultTo('{}');
    t.uuid('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('entity_type').nullable();
    t.text('entity_id').nullable();
    // Stable key of the domain event that produced this row — lets a future
    // at-least-once EventBus reprocess without creating duplicates.
    t.text('source_event_key').nullable();
    t.timestamp('read_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['recipient_user_id', 'created_at'], 'idx_notifications_recipient_recent');
  });
  await knex.raw(
    `ALTER TABLE notifications ADD CONSTRAINT chk_notifications_type CHECK (type ~ '^[A-Z][A-Z0-9_]*$')`,
  );
  await knex.raw(
    `ALTER TABLE notifications ADD CONSTRAINT chk_notifications_title_len
       CHECK (char_length(title) BETWEEN 1 AND 200)`,
  );
  await knex.raw(
    `ALTER TABLE notifications ADD CONSTRAINT chk_notifications_body_len
       CHECK (char_length(body) BETWEEN 1 AND 2000)`,
  );
  // Efficient unread count / unread listing.
  await knex.raw(
    `CREATE INDEX idx_notifications_unread ON notifications (recipient_user_id)
       WHERE read_at IS NULL`,
  );
  // Idempotency: one notification per (recipient, source event).
  await knex.raw(
    `CREATE UNIQUE INDEX uq_notifications_source_event
       ON notifications (recipient_user_id, source_event_key)
       WHERE source_event_key IS NOT NULL`,
  );

  await knex.schema.createTable('notification_preferences', (t) => {
    t.uuid('user_id').primary().references('id').inTable('users').onDelete('CASCADE');
    // In-app notifications are always created; this only gates FCM push.
    // Extensible: add per-type / per-channel columns or a child table later
    // without touching the handler (it calls one `pushEnabled(userId)` check).
    t.boolean('push_enabled').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_preferences');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('device_push_tokens');
}
