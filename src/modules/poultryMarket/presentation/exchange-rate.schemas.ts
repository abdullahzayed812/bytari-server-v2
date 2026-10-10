import { z } from 'zod';
import { isMarketGovernorate } from '../domain/market-governorates.js';
import { dateOnlySchema } from '../../../shared/validation/date-only.js';

const dateSchema = dateOnlySchema();

/** Money as a string — never parsed to a float. `numeric(12,2)`, non-negative. Empty clears the cell. */
const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount')
  .nullable()
  .optional();

export const exchangeRateDateQuerySchema = z.object({ date: dateSchema });
export type ExchangeRateDateQuery = z.infer<typeof exchangeRateDateQuerySchema>;

/**
 * A board row: an Iraqi governorate, or "إقليم كوردستان" — the Kurdistan
 * Region's four governorates are priced ONCE, never individually.
 */
const marketGovernorateSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(isMarketGovernorate, { message: 'Not an exchange-board governorate' });

const poultryRateEntrySchema = z.object({
  governorate: marketGovernorateSchema,
  meatPricePerKg: moneySchema,
  layerPricePerBird: moneySchema,
});

export const savePoultryRatesBodySchema = z.object({
  date: dateSchema,
  entries: z.array(poultryRateEntrySchema).min(1).max(30),
});
export type SavePoultryRatesBody = z.infer<typeof savePoultryRatesBodySchema>;

const eggRateEntrySchema = z.object({
  governorate: marketGovernorateSchema,
  eggPricePerTray: moneySchema,
});

export const saveEggRatesBodySchema = z.object({
  date: dateSchema,
  entries: z.array(eggRateEntrySchema).min(1).max(30),
});
export type SaveEggRatesBody = z.infer<typeof saveEggRatesBodySchema>;
