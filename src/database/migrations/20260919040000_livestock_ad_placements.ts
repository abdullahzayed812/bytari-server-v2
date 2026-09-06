import type { Knex } from 'knex';
import { AD_PLACEMENTS } from '../../modules/advertisements/domain/advertisement.constants.js';

/**
 * Widen `chk_ad_campaigns_placement` to include `SHEEP_FARMS`/`CATTLE_FARMS`
 * (the combined Sheep & Cattle Farms landing screen's ad slot). Per the
 * advertisements module header: adding a section is a value in
 * `AD_PLACEMENTS` + this one-line CHECK-widening migration — never a new
 * table or API. Mirrors `20260913010000_poultry_farms_ad_placement.ts`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
       CHECK (placement IN (${AD_PLACEMENTS.map((p) => `'${p}'`).join(', ')}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const previous = AD_PLACEMENTS.filter((p) => p !== 'SHEEP_FARMS' && p !== 'CATTLE_FARMS');
  await knex.raw(`DELETE FROM ad_campaigns WHERE placement IN ('SHEEP_FARMS', 'CATTLE_FARMS')`);
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
       CHECK (placement IN (${previous.map((p) => `'${p}'`).join(', ')}))`,
  );
}
