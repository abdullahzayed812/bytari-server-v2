import type { Knex } from 'knex';

/**
 * Extend `veterinary_store_products` so a VETERINARY_OFFICE organization can
 * also own products, alongside VETERINARY_STORE (Veterinarian Home →
 * "المكاتب البيطرية"). Widens `chk_vsp_org_type`; the composite FK to
 * `organizations(id, type)` needs no change — it already accepts either type,
 * only the CHECK narrowed it to one.
 *
 * Also aligns `product_type` with the Veterinary Offices product filter chips
 * (المكملات / العناية didn't exist before): MEDICINE stays, EQUIPMENT + SUPPLY
 * merge into EQUIPMENT_SUPPLY, OTHER retires in favour of CARE. Existing rows
 * are remapped, never dropped.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE veterinary_store_products DROP CONSTRAINT IF EXISTS chk_vsp_org_type`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_org_type
       CHECK (organization_type IN ('VETERINARY_STORE', 'VETERINARY_OFFICE'))`,
  );

  await knex.raw(`ALTER TABLE veterinary_store_products DROP CONSTRAINT IF EXISTS chk_vsp_type`);
  await knex.raw(
    `UPDATE veterinary_store_products SET product_type = 'EQUIPMENT_SUPPLY' WHERE product_type IN ('EQUIPMENT', 'SUPPLY')`,
  );
  await knex.raw(
    `UPDATE veterinary_store_products SET product_type = 'CARE' WHERE product_type = 'OTHER'`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_type
       CHECK (product_type IN ('MEDICINE', 'EQUIPMENT_SUPPLY', 'SUPPLEMENT', 'CARE'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE veterinary_store_products DROP CONSTRAINT IF EXISTS chk_vsp_type`);
  await knex.raw(
    `UPDATE veterinary_store_products SET product_type = 'EQUIPMENT' WHERE product_type = 'EQUIPMENT_SUPPLY'`,
  );
  await knex.raw(
    `UPDATE veterinary_store_products SET product_type = 'OTHER' WHERE product_type IN ('SUPPLEMENT', 'CARE')`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_type
       CHECK (product_type IN ('MEDICINE', 'EQUIPMENT', 'SUPPLY', 'OTHER'))`,
  );

  await knex.raw(`DELETE FROM veterinary_store_products WHERE organization_type = 'VETERINARY_OFFICE'`);
  await knex.raw(
    `ALTER TABLE veterinary_store_products DROP CONSTRAINT IF EXISTS chk_vsp_org_type`,
  );
  await knex.raw(
    `ALTER TABLE veterinary_store_products ADD CONSTRAINT chk_vsp_org_type
       CHECK (organization_type = 'VETERINARY_STORE')`,
  );
}
