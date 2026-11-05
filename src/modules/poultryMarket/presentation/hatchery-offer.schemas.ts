import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { phoneSchema } from '../../../shared/validation/common.js';
import { dateOnlySchema } from '../../../shared/validation/date-only.js';
import {
  CHICK_TYPES,
  MAX_CHICK_AGE_DAYS,
  MAX_HATCHERY_OFFER_IMAGES,
} from '../domain/hatchery-offer.constants.js';

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Expected a non-negative amount like "500" or "500.50"');

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

export const hatcheryOfferUploadUrlBodySchema = z
  .object({
    filename,
    mimeType: z.string().trim().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  })
  .strict();
export type HatcheryOfferUploadUrlBody = z.infer<typeof hatcheryOfferUploadUrlBodySchema>;

export const createHatcheryOfferBodySchema = z.object({
  chickType: z.enum(CHICK_TYPES).default('BROILER'),
  breed: z.string().trim().max(160).optional(),
  chickAgeDays: z.coerce.number().int().min(0).max(MAX_CHICK_AGE_DAYS),
  productionDate: dateOnlySchema(),
  quantity: z.coerce.number().int().min(1).max(100_000_000).optional(),
  pricePerChick: moneySchema.optional(),
  governorate: z.string().trim().min(1).max(120),
  district: z.string().trim().max(120).optional(),
  phone: phoneSchema,
  whatsapp: phoneSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  galleryKeys: z
    .array(z.string().trim().min(1).max(1024))
    .max(MAX_HATCHERY_OFFER_IMAGES)
    .default([]),
});
export type CreateHatcheryOfferBody = z.infer<typeof createHatcheryOfferBodySchema>;

export const listHatcheryOffersQuerySchema = paginationQuerySchema.extend({
  chickType: z.enum(CHICK_TYPES).optional(),
  governorate: z.string().trim().min(1).max(120).optional(),
});
export type ListHatcheryOffersQuery = z.infer<typeof listHatcheryOffersQuerySchema>;

export const listAdminHatcheryOffersQuerySchema = listHatcheryOffersQuerySchema.extend({
  status: z.enum(['ACTIVE', 'REMOVED']).optional(),
  moderationStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().min(1).max(160).optional(),
});
export type ListAdminHatcheryOffersQuery = z.infer<typeof listAdminHatcheryOffersQuerySchema>;

export const rejectHatcheryOfferBodySchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();
export type RejectHatcheryOfferBody = z.infer<typeof rejectHatcheryOfferBodySchema>;

export const hatcheryOfferParamSchema = z.object({ offerId: z.string().uuid() });
