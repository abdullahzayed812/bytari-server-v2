import type { Knex } from 'knex';

/**
 * Syndicate registration ("التسجيل في النقابة") + syndicate ↔ member chat.
 *
 * `syndicate_registrations` — a user registering with a SYNDICATE
 * organization. Deliberately NOT an `organization_memberships` row: every
 * ACTIVE membership of a syndicate is an officer (OWNER / SUPERVISOR) and
 * receives the syndicate's request/inquiry notifications
 * (`NotificationPolicy.syndicateOrgMembers`) and org-side chat access, which a
 * registered member must never get. Registration is self-service and
 * immediate (no approval); ending it keeps the row (CANCELLED by the member,
 * REMOVED by a syndicate admin / syndicate deletion) so history survives.
 *
 * `SYNDICATE_MEMBER` conversation type — a syndicate admin ↔ one registered
 * member, same shape as PET_OWNER_VETERINARY_OFFICE: `organization_id` is the
 * syndicate (org side resolved live from ACTIVE `organization_memberships`),
 * `pet_owner_user_id` is the member (the only participant row, role
 * `SYNDICATE_MEMBER`).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('syndicate_registrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.timestamp('registered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.uuid('ended_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['organization_id', 'status', 'registered_at'], 'idx_syndicate_registrations_org');
    t.index(['user_id', 'status'], 'idx_syndicate_registrations_user');
  });
  await knex.raw(`
    ALTER TABLE syndicate_registrations ADD CONSTRAINT chk_syndicate_registrations_status
      CHECK (status IN ('ACTIVE', 'CANCELLED', 'REMOVED'))
  `);
  // One live registration per (syndicate, user); ended rows are history.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_syndicate_registrations_active
      ON syndicate_registrations (organization_id, user_id)
      WHERE status = 'ACTIVE'
  `);

  // --- chat: SYNDICATE_MEMBER ---------------------------------------------
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN', 'PET_OWNER_VETERINARY_OFFICE', 'CHAT_ROOM', 'SYNDICATE_MEMBER'))
  `);
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'           AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN'      AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARY_OFFICE' AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'CHAT_ROOM'                   AND organization_id IS NOT NULL AND pet_owner_user_id IS NULL     AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'SYNDICATE_MEMBER'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL)
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_syndicate_member
      ON conversations (organization_id, pet_owner_user_id)
      WHERE type = 'SYNDICATE_MEMBER'
  `);
  await knex.raw(
    'ALTER TABLE conversation_participants DROP CONSTRAINT IF EXISTS chk_participant_role',
  );
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN', 'ROOM_MEMBER', 'SYNDICATE_MEMBER'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM conversations WHERE type = 'SYNDICATE_MEMBER'`);
  await knex.raw(
    'ALTER TABLE conversation_participants DROP CONSTRAINT IF EXISTS chk_participant_role',
  );
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN', 'ROOM_MEMBER'))
  `);
  await knex.raw('DROP INDEX IF EXISTS uq_conversations_syndicate_member');
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'           AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN'      AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARY_OFFICE' AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'CHAT_ROOM'                   AND organization_id IS NOT NULL AND pet_owner_user_id IS NULL     AND member_user_id IS NULL AND veterinarian_user_id IS NULL)
    )
  `);
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN', 'PET_OWNER_VETERINARY_OFFICE', 'CHAT_ROOM'))
  `);
  await knex.schema.dropTableIfExists('syndicate_registrations');
}
