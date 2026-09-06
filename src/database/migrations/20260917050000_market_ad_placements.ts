import type { Knex } from 'knex';
import { AD_PLACEMENTS } from '../../modules/advertisements/domain/advertisement.constants.js';

/**
 * Widen `chk_ad_campaigns_placement` to include the 4 new Poultry Markets
 * placements. Per the advertisements module header: adding a section is a
 * value in `AD_PLACEMENTS` + this one-line CHECK-widening migration — never a
 * new table or API.
 */
const NEW_PLACEMENTS = ['POULTRY_MARKET', 'EGG_MARKET', 'EXCHANGE_RATES', 'TRADER_REGISTRATION'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
       CHECK (placement IN (${AD_PLACEMENTS.map((p) => `'${p}'`).join(', ')}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const previous = AD_PLACEMENTS.filter((p) => !NEW_PLACEMENTS.includes(p));
  await knex.raw(
    `DELETE FROM ad_campaigns WHERE placement IN (${NEW_PLACEMENTS.map((p) => `'${p}'`).join(', ')})`,
  );
  await knex.raw(`ALTER TABLE ad_campaigns DROP CONSTRAINT IF EXISTS chk_ad_campaigns_placement`);
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
       CHECK (placement IN (${previous.map((p) => `'${p}'`).join(', ')}))`,
  );
}
