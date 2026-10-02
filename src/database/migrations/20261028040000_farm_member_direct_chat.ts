import type { Knex } from 'knex';

/**
 * Farm colleagues chat (final corrections §9): a veterinarian and an employee
 * of the SAME farm can message each other directly — new conversation type
 * `FARM_MEMBER_DIRECT` (organization_id = the farm, the two members in
 * pet_owner_user_id / member_user_id, both with an explicit FARM_MEMBER
 * participant row). Access is re-checked live: both must still be ACTIVE
 * non-owner members of the farm. One conversation per farm + unordered pair.
 *
 * The existing CHECK definitions are read from the catalog and extended, so
 * this migration does not need to restate every earlier conversation shape.
 */
async function constraintBody(knex: Knex, name: string): Promise<string> {
  const res = await knex.raw<{ rows: Array<{ def: string }> }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ?`,
    [name],
  );
  const def = res.rows[0]?.def;
  if (!def) throw new Error(`constraint ${name} not found`);
  return def.replace(/^CHECK\s*/i, '');
}

export async function up(knex: Knex): Promise<void> {
  const typeBody = await constraintBody(knex, 'chk_conversations_type');
  const shapeBody = await constraintBody(knex, 'chk_conversations_shape');

  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type CHECK (${typeBody} OR type = 'FARM_MEMBER_DIRECT')`,
  );
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (${shapeBody} OR
      (type = 'FARM_MEMBER_DIRECT' AND organization_id IS NOT NULL AND pet_owner_user_id IS NOT NULL
        AND member_user_id IS NOT NULL AND veterinarian_user_id IS NULL
        AND pet_owner_user_id <> member_user_id)
    )
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_conversations_farm_member_direct
      ON conversations (
        organization_id,
        LEAST(pet_owner_user_id, member_user_id),
        GREATEST(pet_owner_user_id, member_user_id)
      )
      WHERE type = 'FARM_MEMBER_DIRECT'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM conversations WHERE type = 'FARM_MEMBER_DIRECT'`);
  await knex.raw('DROP INDEX IF EXISTS uq_conversations_farm_member_direct');
  const strip = (body: string, marker: string): string => {
    const i = body.lastIndexOf(marker);
    return i > 0
      ? body
          .slice(0, i)
          .trim()
          .replace(/\s+OR\s*$/i, '')
      : body;
  };
  const typeBody = await constraintBody(knex, 'chk_conversations_type');
  const shapeBody = await constraintBody(knex, 'chk_conversations_shape');
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_type');
  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_type CHECK (${strip(typeBody, "OR (type = 'FARM_MEMBER_DIRECT'")})`,
  );
  await knex.raw('ALTER TABLE conversations DROP CONSTRAINT chk_conversations_shape');
  await knex.raw(
    `ALTER TABLE conversations ADD CONSTRAINT chk_conversations_shape CHECK (${strip(shapeBody, "OR ((type = 'FARM_MEMBER_DIRECT'")})`,
  );
}
