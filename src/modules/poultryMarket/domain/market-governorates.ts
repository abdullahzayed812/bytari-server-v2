import { GOVERNORATES_BY_COUNTRY } from '../../../shared/validation/geography.js';

/**
 * The Kurdistan Region's four governorates. On the poultry / egg exchange
 * boards they are NOT priced separately (final corrections §8): one entry,
 * `KURDISTAN_REGION_MARKET_KEY`, carries ONE price for all four. Mirrored by
 * the mobile `governoratesForMarket()` (`constants/governorates.ts`).
 */
export const KURDISTAN_REGION_GOVERNORATES: readonly string[] = [
  'أربيل',
  'دهوك',
  'السليمانية',
  'حلبجة',
];

export const KURDISTAN_REGION_MARKET_KEY = 'إقليم كوردستان';

/** Valid exchange-board rows: every Iraqi governorate, the Kurdistan four folded into one. */
export const MARKET_GOVERNORATES: readonly string[] = (() => {
  const rows: string[] = [];
  for (const g of GOVERNORATES_BY_COUNTRY.IQ ?? []) {
    if (KURDISTAN_REGION_GOVERNORATES.includes(g)) {
      if (!rows.includes(KURDISTAN_REGION_MARKET_KEY)) rows.push(KURDISTAN_REGION_MARKET_KEY);
      continue;
    }
    rows.push(g);
  }
  return rows;
})();

export function isMarketGovernorate(value: string): boolean {
  return MARKET_GOVERNORATES.includes(value);
}
