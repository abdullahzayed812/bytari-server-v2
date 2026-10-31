import type { Knex } from 'knex';

/**
 * A job offer may carry its own uploaded image (a vet-jobs attachment key).
 * When set it is the offer's image; otherwise the linked organization's logo
 * is used as before. NULL for every existing offer, so nothing is migrated.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vet_job_offers', (t) => {
    t.string('image_storage_key', 1024).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vet_job_offers', (t) => {
    t.dropColumn('image_storage_key');
  });
}
