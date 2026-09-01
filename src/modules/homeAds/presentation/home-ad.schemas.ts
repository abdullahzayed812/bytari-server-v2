import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { MAX_IMAGE_BYTES, SUBTITLE_MAX, TITLE_MAX } from '../domain/home-ad.constants.js';

export const homeAdIdParamSchema = z.object({ homeAdId: z.string().uuid() });

const title = z.string().trim().min(1).max(TITLE_MAX);
const subtitle = z.string().trim().min(1).max(SUBTITLE_MAX);
const sortOrder = z.number().int();

/** `createdBy` / `isActive` / image fields are server-controlled — `.strict()` rejects them. */
export const createHomeAdBodySchema = z
  .object({
    title,
    subtitle: subtitle.nullable().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict();

export const updateHomeAdBodySchema = z
  .object({
    title: title.optional(),
    subtitle: subtitle.nullable().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listAdminHomeAdsQuerySchema = paginationQuerySchema.extend({
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

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
const mimeType = z.string().trim().min(1).max(255);

export const uploadUrlBodySchema = z
  .object({
    filename,
    mimeType,
    size: z.number().int().positive().max(MAX_IMAGE_BYTES),
  })
  .strict();

export const registerImageBodySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(1024),
    mimeType,
  })
  .strict();

export type CreateHomeAdBody = z.infer<typeof createHomeAdBodySchema>;
export type UpdateHomeAdBody = z.infer<typeof updateHomeAdBodySchema>;
export type ListAdminHomeAdsQuery = z.infer<typeof listAdminHomeAdsQuerySchema>;
export type UploadUrlBody = z.infer<typeof uploadUrlBodySchema>;
export type RegisterImageBody = z.infer<typeof registerImageBodySchema>;
