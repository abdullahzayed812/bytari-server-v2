import type { Knex } from 'knex';

/**
 * Phase 2 — Audit log foundation.
 *
 * Append-only record of security-sensitive / administrative actions. Written
 * through `AuditService` only. `actor_user_id` is nullable (system actions) and
 * `ON DELETE SET NULL` so audit history survives even if an identity row is
 * ever removed. Never stores passwords or tokens.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('action').notNullable();
    t.text('entity_type').notNullable();
    t.uuid('entity_id').nullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.text('ip').nullable();
    t.text('user_agent').nullable();
    t.text('request_id').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('actor_user_id', 'idx_audit_logs_actor');
    t.index('action', 'idx_audit_logs_action');
    t.index(['entity_type', 'entity_id'], 'idx_audit_logs_entity');
    t.index('created_at', 'idx_audit_logs_created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}
