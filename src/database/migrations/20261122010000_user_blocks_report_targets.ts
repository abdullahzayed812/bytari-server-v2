import type { Knex } from 'knex';

const OLD_TARGETS = ['MESSAGE', 'ROOM'];
const NEW_TARGETS = [
  'MESSAGE',
  'ROOM',
  'USER',
  'ANIMAL_PUBLICATION',
  'ORGANIZATION',
  'ORGANIZATION_REVIEW',
  'CONTENT_COMMENT',
  'AI_MESSAGE',
];

const targetCheck = (targets: string[]): string =>
  `ALTER TABLE content_reports ADD CONSTRAINT chk_content_reports_target_type
     CHECK (target_type IN (${targets.map((t) => `'${t}'`).join(', ')}))`;

/**
 * Google Play User-Generated-Content + AI-Generated-Content policies:
 *  - `user_blocks` — a user blocks another user (no more direct messages
 *    either way; the blocker no longer sees the blocked user's room messages).
 *  - `content_reports.target_type` widened: users, listings, organizations,
 *    reviews, comments and AI assistant answers can now be reported too.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_blocks', (t) => {
    t.uuid('blocker_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('blocked_user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['blocker_user_id', 'blocked_user_id']);
    t.index('blocked_user_id', 'idx_user_blocks_blocked');
  });
  await knex.raw(
    `ALTER TABLE user_blocks ADD CONSTRAINT chk_user_blocks_not_self
       CHECK (blocker_user_id <> blocked_user_id)`,
  );

  await knex.raw(
    'ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS chk_content_reports_target_type',
  );
  await knex.raw(targetCheck(NEW_TARGETS));
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `DELETE FROM content_reports WHERE target_type NOT IN (${OLD_TARGETS.map((t) => `'${t}'`).join(', ')})`,
  );
  await knex.raw(
    'ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS chk_content_reports_target_type',
  );
  await knex.raw(targetCheck(OLD_TARGETS));
  await knex.schema.dropTableIfExists('user_blocks');
}
