import { computeTrend, type MarketBoard, type Trend } from './exchange-rate.constants.js';

export interface MarketExchangeRateRow {
  id: string;
  board: string;
  governorate: string;
  rate_date: string;
  meat_price_per_kg: string | null;
  layer_price_per_bird: string | null;
  egg_price_per_tray: string | null;
  recorded_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MarketExchangeRateRecord {
  id: string;
  board: MarketBoard;
  governorate: string;
  rateDate: string;
  meatPricePerKg: string | null;
  layerPricePerBird: string | null;
  eggPricePerTray: string | null;
  recordedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function rowToExchangeRate(row: MarketExchangeRateRow): MarketExchangeRateRecord {
  return {
    id: row.id,
    board: row.board as MarketBoard,
    governorate: row.governorate,
    rateDate: row.rate_date,
    meatPricePerKg: row.meat_price_per_kg,
    layerPricePerBird: row.layer_price_per_bird,
    eggPricePerTray: row.egg_price_per_tray,
    recordedByUserId: row.recorded_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** One saved row for the POULTRY board entry form. */
export interface PoultryRateEntryInput {
  governorate: string;
  meatPricePerKg?: string | null;
  layerPricePerBird?: string | null;
}

/** One saved row for the EGG board entry form. */
export interface EggRateEntryInput {
  governorate: string;
  eggPricePerTray?: string | null;
}

/** One governorate row for the POULTRY board viewer, with trend vs. the previous entry. */
export interface PoultryRateEntry {
  governorate: string;
  meatPricePerKg: string | null;
  layerPricePerBird: string | null;
  meatTrend: Trend | null;
  layerTrend: Trend | null;
}

/** One governorate row for the EGG board viewer, with trend vs. the previous entry. */
export interface EggRateEntry {
  governorate: string;
  eggPricePerTray: string | null;
  trend: Trend | null;
}

export function toPoultryRateEntry(
  current: MarketExchangeRateRecord,
  previous: MarketExchangeRateRecord | null,
): PoultryRateEntry {
  return {
    governorate: current.governorate,
    meatPricePerKg: current.meatPricePerKg,
    layerPricePerBird: current.layerPricePerBird,
    meatTrend: computeTrend(current.meatPricePerKg, previous?.meatPricePerKg),
    layerTrend: computeTrend(current.layerPricePerBird, previous?.layerPricePerBird),
  };
}

export function toEggRateEntry(
  current: MarketExchangeRateRecord,
  previous: MarketExchangeRateRecord | null,
): EggRateEntry {
  return {
    governorate: current.governorate,
    eggPricePerTray: current.eggPricePerTray,
    trend: computeTrend(current.eggPricePerTray, previous?.eggPricePerTray),
  };
}
