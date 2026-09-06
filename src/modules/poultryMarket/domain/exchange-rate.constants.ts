/**
 * Poultry Markets module — exchange-rate ("bourse") domain constants. Two
 * conceptual boards share one table via a `board` discriminator: POULTRY
 * (live meat/layer bird prices) and EGG (egg-tray price).
 */

export const MARKET_BOARDS = ['POULTRY', 'EGG'] as const;
export type MarketBoard = (typeof MARKET_BOARDS)[number];

export const TRENDS = ['UP', 'DOWN', 'FLAT'] as const;
export type Trend = (typeof TRENDS)[number];

export function computeTrend(
  current: string | null,
  previous: string | null | undefined,
): Trend | null {
  if (current === null) return null;
  if (previous === null || previous === undefined) return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (cur > prev) return 'UP';
  if (cur < prev) return 'DOWN';
  return 'FLAT';
}
