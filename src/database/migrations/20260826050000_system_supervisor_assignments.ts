import type { Knex } from 'knex';

/**
 * System Supervisor foundation.
 *
 * An Admin-assigned, domain-scoped supervision responsibility. It is NOT a
 * role — a user keeps their primary global role(s) and additionally holds
 * zero or more supervisor assignments. Organisation-scoped supervisors are a
 * later phase and live in a separate table.
 *
 * `domain` carries every system-wide supervisor domain used across the
 * platform (consolidated here rather than widened by a chain of later
 * migrations — new domains only ever add a value to this one CHECK).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('system_supervisor_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('domain').notNullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.uuid('assigned_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('domain', 'idx_supervisor_assignments_domain');
    t.index('user_id', 'idx_supervisor_assignments_user');
  });

  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (
        'ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY',
        'SUPPORT', 'ADVERTISEMENT', 'MARKET', 'PET_OWNER_STORE', 'VET_SERVICE',
        'VETERINARIAN_STORE'
      ))
  `);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_status
      CHECK (status IN ('ACTIVE', 'INACTIVE'))
  `);

  // At most one ACTIVE assignment per (user, domain).
  await knex.raw(`
    CREATE UNIQUE INDEX uq_supervisor_active_user_domain
      ON system_supervisor_assignments (user_id, domain)
      WHERE status = 'ACTIVE'
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('system_supervisor_assignments');
}
