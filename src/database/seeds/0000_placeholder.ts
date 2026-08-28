import type { Knex } from 'knex';

/**
 * Placeholder seed proving the seed runner is wired up.
 *
 * Phase 2 replaces this with real seeds for base roles and the system
 * permission catalogue. Keep seeds idempotent (upsert / delete-then-insert).
 */
export function seed(_knex: Knex): Promise<void> {
  // Intentionally empty for Phase 1.
  return Promise.resolve();
}
