import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z
  .string()
  .regex(DATE_RE, 'Expected YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

/** Money as a string — never parsed to a float. `numeric(12,2)`, non-negative. Empty clears the cell. */
const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount')
  .nullable()
  .optional();

export const exchangeRateDateQuerySchema = z.object({ date: dateSchema });
export type ExchangeRateDateQuery = z.infer<typeof exchangeRateDateQuerySchema>;

const poultryRateEntrySchema = z.object({
  governorate: z.string().trim().min(1).max(120),
  meatPricePerKg: moneySchema,
  layerPricePerBird: moneySchema,
});

export const savePoultryRatesBodySchema = z.object({
  date: dateSchema,
  entries: z.array(poultryRateEntrySchema).min(1).max(30),
});
export type SavePoultryRatesBody = z.infer<typeof savePoultryRatesBodySchema>;

const eggRateEntrySchema = z.object({
  governorate: z.string().trim().min(1).max(120),
  eggPricePerTray: moneySchema,
});

export const saveEggRatesBodySchema = z.object({
  date: dateSchema,
  entries: z.array(eggRateEntrySchema).min(1).max(30),
});
export type SaveEggRatesBody = z.infer<typeof saveEggRatesBodySchema>;
