import type { Knex } from 'knex';

/**
 * Adoption / Mating / Lost listings — outcome + owner↔interested-user contact
 * (correction phase 2026-09-30 §11/§12).
 *
 * 1. `animal_publications.resolution` — the listing's OUTCOME, a separate axis
 *    from the moderation `status` (PENDING/APPROVED/REJECTED, unchanged):
 *    NULL = still available; `FOUND` (LOST only), `ADOPTED` (ADOPTION only),
 *    `CLOSED` (any kind — the owner withdraws it). Set/cleared by the owner.
 * 2. `animal_publication_interactions.conversation_id` — each request /
 *    sighting report is linked to the chat conversation between the
 *    interested user and the listing owner.
 * 3. Chat: conversation type `ANIMAL_PUBLICATION` (interested user in
 *    `pet_owner_user_id`, listing owner in `member_user_id`, pinned to the
 *    publication via subject `ANIMAL_PUBLICATION`), one per (listing, user);
 *    participant role `LISTING_OWNER`. Same chat system — messages,
 *    attachments, realtime and read state are reused unchanged.
 *
 * Additive only; existing rows keep NULL resolution / conversation.
 */
const TYPES_BEFORE = `'PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN', 'PET_OWNER_VETERINARY_OFFICE', 'CHAT_ROOM', 'SYNDICATE_MEMBER'`;
const SHAPE_BEFORE = `
      (type = 'PET_OWNER_CLINIC'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'FARM_OWNER_MEMBER'           AND organization_id IS NOT NULL AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARIAN'      AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND veterinarian_user_id IS NOT NULL AND member_user_id IS NULL) OR
      (type = 'PET_OWNER_VETERINARY_OFFICE' AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'CHAT_ROOM'                   AND organization_id IS NOT NULL AND pet_owner_user_id IS NULL     AND member_user_id IS NULL AND veterinarian_user_id IS NULL) OR
      (type = 'SYNDICATE_MEMBER'            AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL AND veterinarian_user_id IS NULL)`;
const SUBJECTS_BEFORE = `'VET_SERVICE_OFFER', 'VET_SERVICE_LISTING_REQUEST', 'VET_JOB_APPLICATION'`;
const ROLES_BEFORE = `'PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN', 'ROOM_MEMBER', 'SYNDICATE_MEMBER'`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('animal_publications', (t) => {
    t.text('resolution').nullable();
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.uuid('resolved_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.raw(`
    ALTER TABLE animal_publications ADD CONSTRAINT chk_animal_publications_resolution CHECK (
      resolution IS NULL OR
      resolution = 'CLOSED' OR
      (resolution = 'FOUND' AND kind = 'LOST') OR
      (resolution = 'ADOPTED' AND kind = 'ADOPTION')
    )
  `);

  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
      CHECK (type IN (${TYPES_BEFORE}, 'ANIMAL_PUBLICATION'))
  `);
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (${SHAPE_BEFORE} OR
      (type = 'ANIMAL_PUBLICATION'          AND organization_id IS NULL     AND pet_owner_user_id IS NOT NULL AND member_user_id IS NOT NULL AND veterinarian_user_id IS NULL AND subject_id IS NOT NULL)
    )
  `);
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_subject');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_subject CHECK (
      (subject_type IS NULL AND subject_id IS NULL) OR
      (subject_type IN (${SUBJECTS_BEFORE}, 'ANIMAL_PUBLICATION') AND subject_id IS NOT NULL)
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_animal_publication
      ON conversations (subject_id, pet_owner_user_id)
      WHERE type = 'ANIMAL_PUBLICATION'
  `);
  await knex.raw(
    'ALTER TABLE conversation_participants DROP CONSTRAINT IF EXISTS chk_participant_role',
  );
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN (${ROLES_BEFORE}, 'LISTING_OWNER'))
  `);

  await knex.schema.alterTable('animal_publication_interactions', (t) => {
    t.uuid('conversation_id')
      .nullable()
      .references('id')
      .inTable('conversations')
      .onDelete('SET NULL');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('animal_publication_interactions', (t) => {
    t.dropColumn('conversation_id');
  });
  await knex.raw(`DELETE FROM conversations WHERE type = 'ANIMAL_PUBLICATION'`);
  await knex.raw(
    'ALTER TABLE conversation_participants DROP CONSTRAINT IF EXISTS chk_participant_role',
  );
  await knex.raw(`
    ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
      CHECK (role IN (${ROLES_BEFORE}))
  `);
  await knex.raw('DROP INDEX IF EXISTS uq_conversations_animal_publication');
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_subject');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_subject CHECK (
      (subject_type IS NULL AND subject_id IS NULL) OR
      (subject_type IN (${SUBJECTS_BEFORE}) AND subject_id IS NOT NULL)
    )
  `);
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (${SHAPE_BEFORE})`,
  );
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type CHECK (type IN (${TYPES_BEFORE}))
  `);
  await knex.raw(
    'ALTER TABLE animal_publications DROP CONSTRAINT IF EXISTS chk_animal_publications_resolution',
  );
  await knex.schema.alterTable('animal_publications', (t) => {
    t.dropColumn('resolved_by_user_id');
    t.dropColumn('resolved_at');
    t.dropColumn('resolution');
  });
}
