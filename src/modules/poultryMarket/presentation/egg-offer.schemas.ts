import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { phoneSchema } from '../../../shared/validation/common.js';
import { EGG_TYPES, MAX_EGG_OFFER_IMAGES, SELL_UNITS } from '../domain/egg-offer.constants.js';

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount like "5000" or "5000.50"');

const hasControlChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};
const filename = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((v) => !v.includes('/') && !v.includes('\\') && !hasControlChar(v), {
    message: 'filename must not contain path separators or control characters',
  });

export const eggOfferUploadUrlBodySchema = z
  .object({
    filename,
    mimeType: z.string().trim().min(1).max(255),
    size: z.number().int().positive().max(5 * 1024 * 1024),
  })
  .strict();
export type EggOfferUploadUrlBody = z.infer<typeof eggOfferUploadUrlBodySchema>;

export const createEggOfferBodySchema = z.object({
  eggType: z.enum(EGG_TYPES).default('WHITE'),
  sellUnit: z.enum(SELL_UNITS).default('TRAY_30'),
  quantity: z.coerce.number().int().min(1).max(100_000_000),
  pricePerUnit: moneySchema,
  governorate: z.string().trim().min(1).max(120),
  district: z.string().trim().max(120).optional(),
  phone: phoneSchema,
  whatsapp: phoneSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  galleryKeys: z.array(z.string().trim().min(1).max(1024)).max(MAX_EGG_OFFER_IMAGES).default([]),
});
export type CreateEggOfferBody = z.infer<typeof createEggOfferBodySchema>;

export const listEggOffersQuerySchema = paginationQuerySchema.extend({
  eggType: z.enum(EGG_TYPES).optional(),
  governorate: z.string().trim().min(1).max(120).optional(),
});
export type ListEggOffersQuery = z.infer<typeof listEggOffersQuerySchema>;

export const listAdminEggOffersQuerySchema = listEggOffersQuerySchema.extend({
  status: z.enum(['ACTIVE', 'REMOVED']).optional(),
});
export type ListAdminEggOffersQuery = z.infer<typeof listAdminEggOffersQuerySchema>;

export const eggOfferParamSchema = z.object({ offerId: z.string().uuid() });
