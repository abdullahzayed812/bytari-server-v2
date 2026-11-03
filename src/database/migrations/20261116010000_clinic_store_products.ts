import type { Knex } from 'knex';

/**
 * Clinic Store — a CLINIC organization may own a product catalogue too.
 *
 * Clinic products reuse `veterinary_office_products` (same columns, images,
 * hidden flag, currency, public catalogue) instead of a third copy of the
 * table: the composite FK `(organization_id, organization_type) →
 * organizations(id, type)` still pins every row to its real organization type,
 * the CHECK below just admits CLINIC beside VETERINARY_OFFICE. Existing rows
 * are all VETERINARY_OFFICE and stay valid.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    'ALTER TABLE veterinary_office_products DROP CONSTRAINT IF EXISTS chk_vop_org_type',
  );
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_org_type
       CHECK (organization_type IN ('VETERINARY_OFFICE', 'CLINIC'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // Clinic products cannot survive the narrower constraint.
  await knex('veterinary_office_products').where({ organization_type: 'CLINIC' }).delete();
  await knex.raw(
    'ALTER TABLE veterinary_office_products DROP CONSTRAINT IF EXISTS chk_vop_org_type',
  );
  await knex.raw(
    `ALTER TABLE veterinary_office_products ADD CONSTRAINT chk_vop_org_type
       CHECK (organization_type = 'VETERINARY_OFFICE')`,
  );
}
