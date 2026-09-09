import type { Knex } from 'knex';

/**
 * Additive extension of the Phase-12 chat schema for the Veterinary Services
 * marketplace: a true 1:1 Pet Owner ↔ Veterinarian conversation, linked to a
 * service engagement (an offer or a listing-request), with a job status.
 *
 * Nothing about the existing PET_OWNER_CLINIC / FARM_OWNER_MEMBER conversations
 * changes — they keep `organization_id NOT NULL` (still enforced by the shape
 * CHECK below) and their existing participant roles. Consultations / support
 * threads are a different module entirely and are untouched.
 *
 *   - `organization_id`  → made nullable (a marketplace deal has no org).
 *   - `type`             → adds 'PET_OWNER_VETERINARIAN'.
 *   - `subject_type` / `subject_id` → link to the vet-service engagement.
 *   - `status`           → OPEN | COMPLETED | CLOSED (job lifecycle).
 *   - participant role   → adds 'VETERINARIAN'.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE conversations ALTER COLUMN organization_id DROP NOT NULL`);

  await knex.schema.alterTable('conversations', (t) => {
    t.uuid('veterinarian_user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('subject_type').nullable();
    t.uuid('subject_id').nullable();
    t.text('status').notNullable().defaultTo('OPEN');
  });

  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type`);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN'))
  `);

  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape`);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'       AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'      AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN' AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL)
    )
  `);

  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_status
      CHECK (status IN ('OPEN', 'COMPLETED', 'CLOSED'))
  `);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_subject
      CHECK (
        (subject_type IS NULL AND subject_id IS NULL) OR
        (subject_type IN ('VET_SERVICE_OFFER', 'VET_SERVICE_LISTING_REQUEST') AND subject_id IS NOT NULL)
      )
  `);

  // One conversation per Pet Owner ↔ Vet pair (subject switches over the deal's life).
  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_pet_owner_vet
      ON conversations (pet_owner_user_id, veterinarian_user_id)
      WHERE type = 'PET_OWNER_VETERINARIAN'
  `);

  await knex.raw(`ALTER TABLE conversation_participants DROP CONSTRAINT chk_participant_role`);
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE conversation_participants DROP CONSTRAINT chk_participant_role`);
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER'))
  `);

  await knex.raw(`DROP INDEX IF EXISTS uq_conversations_pet_owner_vet`);
  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT chk_conversations_subject`);
  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT chk_conversations_status`);
  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape`);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
      (type = 'PET_OWNER_CLINIC'  AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER' AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL)
    )
  `);
  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type`);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER'))
  `);

  await knex.raw(`DELETE FROM conversations WHERE type = 'PET_OWNER_VETERINARIAN'`);
  await knex.schema.alterTable('conversations', (t) => {
    t.dropColumn('veterinarian_user_id');
    t.dropColumn('subject_type');
    t.dropColumn('subject_id');
    t.dropColumn('status');
  });
  await knex.raw(`ALTER TABLE conversations ALTER COLUMN organization_id SET NOT NULL`);
}
