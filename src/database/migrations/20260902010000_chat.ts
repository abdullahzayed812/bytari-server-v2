import type { Knex } from 'knex';

/**
 * Chat & Real-Time Messaging.
 *
 * Three conversation contexts — no open group chat, no member↔member:
 *
 *   PET_OWNER_CLINIC        Pet Owner ↔ Clinic (the CLINIC organization, not a
 *                           specific veterinarian). Any ACTIVE clinic member
 *                           may act on the clinic side — resolved live from
 *                           `organization_memberships`, so there is only a
 *                           `conversation_participants` row for the pet owner.
 *   FARM_OWNER_MEMBER       Farm Owner ↔ one assigned Veterinarian / Employee
 *                           of the FARM. Both individuals get a participant
 *                           row; the owner side is still re-checked against
 *                           the *current* `organizations.owner_user_id` and
 *                           the member side against *current* ACTIVE
 *                           membership.
 *   PET_OWNER_VETERINARIAN  A true 1:1 [any user] ↔ Veterinarian conversation,
 *                           reused by both the Veterinary Services marketplace
 *                           and Veterinarian Jobs, linked to an engagement (a
 *                           service offer / listing request, or a job
 *                           application) via `subject_type`/`subject_id`, with
 *                           a job `status`. Has no organization —
 *                           `organization_id` is nullable for exactly this
 *                           type. (The "pet owner" column name is historical —
 *                           every user holds the PET_OWNER base role, so it
 *                           doubles as "the other party" for Jobs threads.)
 *
 * PET_OWNER_CLINIC / FARM_OWNER_MEMBER are anchored to an organization
 * (`organization_id`); PET_OWNER_VETERINARIAN is not. There is no free DIRECT
 * user-to-user conversation.
 *
 * NOT modelled (spec defines nothing / out of scope): message edit history,
 * media / file attachments (would use the R2 seam — no binaries in PG),
 * reactions, typing indicators, per-clinic-member read state, message search.
 * `messages.type` allows only TEXT from clients; SYSTEM is reserved.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('conversations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('type').notNullable();
    // NULL only for PET_OWNER_VETERINARIAN — a marketplace deal has no org.
    t.uuid('organization_id').nullable().references('id').inTable('organizations').onDelete('CASCADE');
    // PET_OWNER_CLINIC / PET_OWNER_VETERINARIAN: the pet owner. NULL for FARM_OWNER_MEMBER.
    t.uuid('pet_owner_user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    // FARM_OWNER_MEMBER: the assigned (non-owner) farm member. NULL otherwise.
    t.uuid('member_user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('last_message_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // PET_OWNER_VETERINARIAN only.
    t.uuid('veterinarian_user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('subject_type').nullable();
    t.uuid('subject_id').nullable();
    // Job lifecycle for PET_OWNER_VETERINARIAN; unused by the other two types.
    t.text('status').notNullable().defaultTo('OPEN');

    t.index('organization_id', 'idx_conversations_org');
    t.index(['organization_id', 'last_message_at'], 'idx_conversations_org_recent');
  });

  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
       CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER', 'PET_OWNER_VETERINARIAN'))`,
  );
  // Shape of each type: exactly the right individual column is populated.
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
        (subject_type IN ('VET_SERVICE_OFFER', 'VET_SERVICE_LISTING_REQUEST', 'VET_JOB_APPLICATION') AND subject_id IS NOT NULL)
      )
  `);
  // One conversation per relationship (enforced in the DB, not just the app).
  await knex.raw(
    `CREATE UNIQUE INDEX uq_conversations_pet_owner_clinic
       ON conversations (organization_id, pet_owner_user_id)
       WHERE type = 'PET_OWNER_CLINIC'`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_conversations_farm_member
       ON conversations (organization_id, member_user_id)
       WHERE type = 'FARM_OWNER_MEMBER'`,
  );
  // One conversation per Pet Owner ↔ Vet pair (subject switches over the deal's life).
  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_pet_owner_vet
      ON conversations (pet_owner_user_id, veterinarian_user_id)
      WHERE type = 'PET_OWNER_VETERINARIAN'
  `);

  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('conversation_id')
      .notNullable()
      .references('id')
      .inTable('conversations')
      .onDelete('CASCADE');
    t.uuid('sender_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('body').notNullable();
    t.text('type').notNullable().defaultTo('TEXT');
    // Soft delete: the row stays so ordering / unread state / history survive.
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.uuid('deleted_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // The one hot query: a page of a conversation ordered deterministically.
    t.index(['conversation_id', 'created_at', 'id'], 'idx_messages_conversation_ordered');
  });

  await knex.raw(
    `ALTER TABLE messages ADD CONSTRAINT chk_messages_type CHECK (type IN ('TEXT', 'SYSTEM'))`,
  );
  await knex.raw(
    `ALTER TABLE messages ADD CONSTRAINT chk_messages_body_len
       CHECK (char_length(body) BETWEEN 1 AND 4000)`,
  );

  await knex.schema.createTable('conversation_participants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('conversation_id')
      .notNullable()
      .references('id')
      .inTable('conversations')
      .onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('role').notNullable();
    t.uuid('last_read_message_id')
      .nullable()
      .references('id')
      .inTable('messages')
      .onDelete('SET NULL');
    t.timestamp('joined_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('left_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['conversation_id', 'user_id'], { indexName: 'uq_participant_conversation_user' });
    t.index(['user_id', 'conversation_id'], 'idx_participants_user');
  });

  await knex.raw(
    `ALTER TABLE conversation_participants ADD CONSTRAINT chk_participant_role
       CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER', 'VETERINARIAN'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('conversation_participants');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('conversations');
}
