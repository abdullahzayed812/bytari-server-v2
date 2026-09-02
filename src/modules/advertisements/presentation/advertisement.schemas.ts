import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  AD_PLACEMENTS,
  AD_TYPES,
  CTA_LABEL_MAX,
  CTA_URL_MAX,
  MAX_IMAGE_BYTES,
  SUBTITLE_MAX,
  TITLE_MAX,
} from '../domain/advertisement.constants.js';

export const placementSchema = z.enum(AD_PLACEMENTS);
export const typeSchema = z.enum(AD_TYPES);

export const campaignIdParamSchema = z.object({ campaignId: z.string().uuid() });
export const slideParamsSchema = z.object({
  campaignId: z.string().uuid(),
  slideId: z.string().uuid(),
});

const campaignTitle = z.string().trim().min(1).max(TITLE_MAX);
const sortOrder = z.number().int();
const isoDateTime = z.string().datetime({ offset: true });

/** `isActive` / slides / image / createdBy are server-controlled. */
export const createCampaignBodySchema = z
  .object({
    placement: placementSchema,
    type: typeSchema,
    title: campaignTitle,
    sortOrder: sortOrder.optional(),
    startsAt: isoDateTime.nullable().optional(),
    endsAt: isoDateTime.nullable().optional(),
  })
  .strict();

export const updateCampaignBodySchema = z
  .object({
    title: campaignTitle.optional(),
    sortOrder: sortOrder.optional(),
    startsAt: isoDateTime.nullable().optional(),
    endsAt: isoDateTime.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listAdminCampaignsQuerySchema = paginationQuerySchema.extend({
  placement: placementSchema.optional(),
  type: typeSchema.optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

/** Public feed — `GET /ads?placement=HOME`. */
export const listPublicAdsQuerySchema = z.object({
  placement: placementSchema.default('HOME'),
});

const slideTitle = z.string().trim().min(1).max(TITLE_MAX);
const slideSubtitle = z.string().trim().min(1).max(SUBTITLE_MAX);
const ctaLabel = z.string().trim().min(1).max(CTA_LABEL_MAX);
const ctaUrl = z.string().trim().min(1).max(CTA_URL_MAX);

export const createSlideBodySchema = z
  .object({
    title: slideTitle.nullable().optional(),
    subtitle: slideSubtitle.nullable().optional(),
    ctaLabel: ctaLabel.nullable().optional(),
    ctaUrl: ctaUrl.nullable().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict();

export const updateSlideBodySchema = z
  .object({
    title: slideTitle.nullable().optional(),
    subtitle: slideSubtitle.nullable().optional(),
    ctaLabel: ctaLabel.nullable().optional(),
    ctaUrl: ctaUrl.nullable().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const reorderSlidesBodySchema = z
  .object({ slideIds: z.array(z.string().uuid()).min(1) })
  .strict();

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

export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;
export type UpdateCampaignBody = z.infer<typeof updateCampaignBodySchema>;
export type ListAdminCampaignsQuery = z.infer<typeof listAdminCampaignsQuerySchema>;
export type ListPublicAdsQuery = z.infer<typeof listPublicAdsQuerySchema>;
export type CreateSlideBody = z.infer<typeof createSlideBodySchema>;
export type UpdateSlideBody = z.infer<typeof updateSlideBodySchema>;
export type ReorderSlidesBody = z.infer<typeof reorderSlidesBodySchema>;
export type UploadUrlBody = z.infer<typeof uploadUrlBodySchema>;
export type RegisterImageBody = z.infer<typeof registerImageBodySchema>;
