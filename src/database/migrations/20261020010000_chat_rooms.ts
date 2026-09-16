import type { Knex } from 'knex';

/**
 * Global Chat — public discussion rooms ("الأغنام والماعز", "الدواجن", …).
 *
 * Modeled exactly like SYNDICATE: a room is an `organizations` row
 * (`type = 'CHAT_ROOM'`), reusing the existing organization aggregate + its
 * per-instance membership/supervisor RBAC (`organization_memberships` /
 * `organization_supervisor_permissions`) for join/leave and moderator
 * assignment. Unlike SYNDICATE, `chat_room_details` deliberately mirrors the
 * FULL `clinic_details`/`veterinary_office_details`/`veterinary_store_details`
 * shape (even though a room only ever uses `logo_key`) so the already-built
 * generic profile-update + logo upload/replace/remove endpoints
 * (`OrganizationPolicy.hasProfileFields`, `OrganizationRepository
 * .updateProfileFields`/`findProfileRow`) work for rooms with ZERO special
 * casing — no third media/profile seam next to the directory-profile one and
 * the syndicate-specific one.
 *
 * The room's discussion itself reuses the existing `conversations`/`messages`/
 * `conversation_participants` tables as-is (see the sibling `chat` module
 * migrations) — only the `CHAT_ROOM` conversation type + `ROOM_MEMBER`
 * participant role are added here, plus one new per-participant
 * `notifications_muted` flag (no per-conversation mute existed anywhere
 * before this).
 */
export async function up(knex: Knex): Promise<void> {
  // --- widen the organizations type enum ----------------------------------
  await knex.raw(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_organizations_type`);
  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_type
      CHECK (type IN ('CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE', 'SYNDICATE', 'CHAT_ROOM'))
  `);

  // --- chat_room_details (same shape as the directory-profile tables) ----
  await knex.schema.createTable('chat_room_details', (t) => {
    t.uuid('organization_id').primary().references('id').inTable('organizations').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('address').nullable();
    t.double('latitude').nullable();
    t.double('longitude').nullable();
    t.text('phone').nullable();
    t.text('logo_key').nullable();
    t.text('working_hours').nullable();
    t.specificType('services', 'text[]').nullable();
    t.text('email').nullable();
    t.text('whatsapp').nullable();
    t.text('instagram_url').nullable();
    t.text('facebook_url').nullable();
    t.text('tiktok_url').nullable();
    t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('website_url').nullable();
    t.text('country').nullable();
    // Room-specific fields.
    t.text('rules').nullable();
    t.uuid('pinned_message_id').nullable().references('id').inTable('messages').onDelete('SET NULL');
  });
  await knex.raw(`
    ALTER TABLE chat_room_details ADD CONSTRAINT chk_chat_room_details_latitude
      CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)
  `);
  await knex.raw(`
    ALTER TABLE chat_room_details ADD CONSTRAINT chk_chat_room_details_longitude
      CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  `);
  await knex.raw(`
    ALTER TABLE chat_room_details ADD CONSTRAINT chk_chat_room_details_coords_pair
      CHECK ((latitude IS NULL) = (longitude IS NULL))
  `);

  // --- widen conversations for the CHAT_ROOM type -------------------------
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN', 'PET_OWNER_VETERINARY_OFFICE', 'CHAT_ROOM'))
  `);
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
  // One conversation per room (its whole discussion thread).
  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_chat_room
      ON conversations (organization_id)
      WHERE type = 'CHAT_ROOM'
  `);

  await knex.raw('ALTER TABLE conversation_participants DROP CONSTRAINT chk_participant_role');
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN', 'ROOM_MEMBER'))
  `);

  // Per-member "mute this room's notifications" — no per-conversation mute
  // existed anywhere before Global Chat.
  await knex.schema.alterTable('conversation_participants', (t) => {
    t.boolean('notifications_muted').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('conversation_participants', (t) => {
    t.dropColumn('notifications_muted');
  });
  await knex.raw('ALTER TABLE conversation_participants DROP CONSTRAINT chk_participant_role');
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN'))
  `);

  await knex.raw('DROP INDEX IF EXISTS uq_conversations_chat_room');
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'           AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN'      AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARY_OFFICE' AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL)
    )
  `);
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN', 'PET_OWNER_VETERINARY_OFFICE'))
  `);

  await knex.schema.dropTableIfExists('chat_room_details');

  await knex.raw(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_organizations_type`);
  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_type
      CHECK (type IN ('CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE', 'SYNDICATE'))
  `);
}
