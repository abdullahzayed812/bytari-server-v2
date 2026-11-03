import type { Knex } from 'knex';

/**
 * Admin-managed video links attached to acceptance notifications (pet owner
 * registration, veterinarian approval, clinic / office / poultry / sheep /
 * cattle farm approval). One optional http(s) URL per key; no row = the
 * notification carries no video. Managed with the existing
 * `notification.admin.send` permission (no new key).
 */
const KEYS = [
  'PET_OWNER_REGISTERED',
  'VETERINARIAN_APPROVED',
  'CLINIC_APPROVED',
  'VETERINARY_OFFICE_APPROVED',
  'POULTRY_FARM_APPROVED',
  'SHEEP_FARM_APPROVED',
  'CATTLE_FARM_APPROVED',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_video_links', (t) => {
    t.text('link_key').primary();
    t.text('url').notNullable();
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE notification_video_links ADD CONSTRAINT chk_notification_video_links_key
       CHECK (link_key IN (${KEYS.map((k) => `'${k}'`).join(', ')}))`,
  );
  // No `?` in the pattern: knex.raw would treat it as a binding placeholder.
  await knex.raw(
    `ALTER TABLE notification_video_links ADD CONSTRAINT chk_notification_video_links_url
       CHECK (url ~* '^https{0,1}://')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_video_links');
}
