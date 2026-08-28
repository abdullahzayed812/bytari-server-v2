import type { Knex } from 'knex';

/**
 * Phase 12 — Chat & Real-Time Messaging.
 *
 * The confirmed spec (docs 01 §9, docs 04 §4.15, UC-018 / UC-019) defines
 * exactly two conversation contexts — no open group chat, no member↔member:
 *
 *   PET_OWNER_CLINIC   Pet Owner ↔ Clinic (the CLINIC organization, not a
 *                      specific veterinarian). Any ACTIVE clinic member may
 *                      act on the clinic side — resolved live from
 *                      `organization_memberships`, so there is only a
 *                      `conversation_participants` row for the pet owner.
 *   FARM_OWNER_MEMBER  Farm Owner ↔ one assigned Veterinarian / Employee of the
 *                      FARM. Both individuals get a participant row; the owner
 *                      side is still re-checked against the *current*
 *                      `organizations.owner_user_id` and the member side against
 *                      *current* ACTIVE membership.
 *
 * Every conversation is anchored to an organization (`organization_id`). There
 * is no free DIRECT user-to-user conversation (not in the spec).
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
    t.uuid('organization_id')
      .notNullable()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    // PET_OWNER_CLINIC: the pet owner. NULL for FARM_OWNER_MEMBER.
    t.uuid('pet_owner_user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    // FARM_OWNER_MEMBER: the assigned (non-owner) farm member. NULL otherwise.
    t.uuid('member_user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('last_message_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_conversations_org');
    t.index(['organization_id', 'last_message_at'], 'idx_conversations_org_recent');
  });

  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type
       CHECK (type IN ('PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER'))`,
  );
  // Shape of each type: exactly the right individual column is populated.
  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (
       (type = 'PET_OWNER_CLINIC'  AND pet_owner_user_id IS NOT NULL AND member_user_id IS NULL) OR
       (type = 'FARM_OWNER_MEMBER' AND member_user_id    IS NOT NULL AND pet_owner_user_id IS NULL)
     )`,
  );
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
       CHECK (role IN ('PET_OWNER', 'FARM_OWNER', 'FARM_MEMBER'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('conversation_participants');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('conversations');
}
