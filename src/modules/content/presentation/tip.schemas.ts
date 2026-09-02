import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  INTRO_MAX,
  MAX_COVER_BYTES,
  MAX_POINTS,
  POINT_MAX,
  READ_MINUTES_MAX,
  READ_MINUTES_MIN,
  SUMMARY_MAX,
  TIP_PRIORITIES,
  TIP_STATUSES,
  TITLE_MAX,
  VET_ADVICE_MAX,
} from '../domain/tip.constants.js';

export const tipIdParamSchema = z.object({ tipId: z.string().uuid() });

const title = z.string().trim().min(1).max(TITLE_MAX);
const summary = z.string().trim().min(1).max(SUMMARY_MAX);
const bodyIntro = z.string().trim().min(1).max(INTRO_MAX);
const vetAdvice = z.string().trim().min(1).max(VET_ADVICE_MAX);
const readMinutes = z.number().int().min(READ_MINUTES_MIN).max(READ_MINUTES_MAX);
const priority = z.enum(TIP_PRIORITIES);
const points = z.array(z.string().trim().min(1).max(POINT_MAX)).max(MAX_POINTS);
const categoryId = z.string().uuid();

/** `status` / `publishedAt` / `isTipOfDay` / `helpfulCount` / cover are server-controlled. */
export const createTipBodySchema = z
  .object({
    title,
    summary: summary.nullable().optional(),
    readMinutes: readMinutes.nullable().optional(),
    priority: priority.optional(),
    categoryId: categoryId.nullable().optional(),
    bodyIntro: bodyIntro.nullable().optional(),
    keyPoints: points.optional(),
    warningPoints: points.optional(),
    vetAdvice: vetAdvice.nullable().optional(),
  })
  .strict();

export const updateTipBodySchema = z
  .object({
    title: title.optional(),
    summary: summary.nullable().optional(),
    readMinutes: readMinutes.nullable().optional(),
    priority: priority.optional(),
    categoryId: categoryId.nullable().optional(),
    bodyIntro: bodyIntro.nullable().optional(),
    keyPoints: points.optional(),
    warningPoints: points.optional(),
    vetAdvice: vetAdvice.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const tipOfDayBodySchema = z.object({ isTipOfDay: z.boolean() }).strict();

export const listPublicTipsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  categoryId: categoryId.optional(),
  priority: priority.optional(),
  bookmarked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const listAdminTipsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  categoryId: categoryId.optional(),
  priority: priority.optional(),
  status: z.enum(TIP_STATUSES).optional(),
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

export const coverUploadUrlBodySchema = z
  .object({
    filename,
    mimeType,
    size: z.number().int().positive().max(MAX_COVER_BYTES),
  })
  .strict();

export const registerCoverBodySchema = z
  .object({ storageKey: z.string().trim().min(1).max(1024), mimeType })
  .strict();

export type CreateTipBody = z.infer<typeof createTipBodySchema>;
export type UpdateTipBody = z.infer<typeof updateTipBodySchema>;
export type TipOfDayBody = z.infer<typeof tipOfDayBodySchema>;
export type ListPublicTipsQuery = z.infer<typeof listPublicTipsQuerySchema>;
export type ListAdminTipsQuery = z.infer<typeof listAdminTipsQuerySchema>;
export type CoverUploadUrlBody = z.infer<typeof coverUploadUrlBodySchema>;
export type RegisterCoverBody = z.infer<typeof registerCoverBodySchema>;
