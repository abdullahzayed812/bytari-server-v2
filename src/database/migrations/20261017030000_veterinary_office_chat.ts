import type { Knex } from 'knex';

/**
 * Adds `PET_OWNER_VETERINARY_OFFICE` — Pet Owner ↔ Veterinary Office, same shape as
 * `PET_OWNER_CLINIC` (org side resolved live from `organization_memberships`, so only the pet
 * owner gets a `conversation_participants` row). Backs the Veterinary Office Dashboard's
 * "المحادثات" screen; see `chat.constants.ts` / `ChatService`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN', 'PET_OWNER_VETERINARY_OFFICE'))
  `);

  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'           AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN'      AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARY_OFFICE' AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL)
    )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_pet_owner_office
      ON conversations (organization_id, pet_owner_user_id)
      WHERE type = 'PET_OWNER_VETERINARY_OFFICE'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS uq_conversations_pet_owner_office');

  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'       AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'      AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN' AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL)
    )
  `);

  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN'))
  `);
}
