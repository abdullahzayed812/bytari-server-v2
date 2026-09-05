import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  ALERT_NOTE_MAX,
  BODY_MAX,
  MAX_IMAGE_BYTES,
  MAX_POINTS,
  NEWS_STATUSES,
  NEWS_TAGS,
  POINT_MAX,
  SOURCE_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
} from '../domain/news.constants.js';

export const newsIdParamSchema = z.object({ newsId: z.string().uuid() });

const title = z.string().trim().min(1).max(TITLE_MAX);
const summary = z.string().trim().min(1).max(SUMMARY_MAX);
const source = z.string().trim().min(1).max(SOURCE_MAX);
const body = z.string().trim().min(1).max(BODY_MAX);
const alertNote = z.string().trim().min(1).max(ALERT_NOTE_MAX);
const tag = z.enum(NEWS_TAGS);
const points = z.array(z.string().trim().min(1).max(POINT_MAX)).max(MAX_POINTS);
const categoryId = z.string().uuid();

/** `status` / `publishedAt` / cover / gallery are server-controlled. */
export const createNewsBodySchema = z
  .object({
    title,
    summary: summary.nullable().optional(),
    source: source.nullable().optional(),
    isFeatured: z.boolean().optional(),
    tag: tag.optional(),
    categoryId: categoryId.nullable().optional(),
    body: body.nullable().optional(),
    reasonPoints: points.optional(),
    advicePoints: points.optional(),
    alertNote: alertNote.nullable().optional(),
  })
  .strict();

export const updateNewsBodySchema = z
  .object({
    title: title.optional(),
    summary: summary.nullable().optional(),
    source: source.nullable().optional(),
    isFeatured: z.boolean().optional(),
    tag: tag.optional(),
    categoryId: categoryId.nullable().optional(),
    body: body.nullable().optional(),
    reasonPoints: points.optional(),
    advicePoints: points.optional(),
    alertNote: alertNote.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const featuredBodySchema = z.object({ isFeatured: z.boolean() }).strict();

export const listPublicNewsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  categoryId: categoryId.optional(),
  tag: tag.optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  bookmarked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const listAdminNewsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  categoryId: categoryId.optional(),
  tag: tag.optional(),
  status: z.enum(NEWS_STATUSES).optional(),
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

export const imageUploadUrlBodySchema = z
  .object({ filename, mimeType, size: z.number().int().positive().max(MAX_IMAGE_BYTES) })
  .strict();

export const registerImageBodySchema = z
  .object({ storageKey: z.string().trim().min(1).max(1024), mimeType })
  .strict();

export const removeGalleryImageQuerySchema = z.object({
  storageKey: z.string().trim().min(1).max(1024),
});

export type CreateNewsBody = z.infer<typeof createNewsBodySchema>;
export type UpdateNewsBody = z.infer<typeof updateNewsBodySchema>;
export type FeaturedBody = z.infer<typeof featuredBodySchema>;
export type ListPublicNewsQuery = z.infer<typeof listPublicNewsQuerySchema>;
export type ListAdminNewsQuery = z.infer<typeof listAdminNewsQuerySchema>;
export type ImageUploadUrlBody = z.infer<typeof imageUploadUrlBodySchema>;
export type RegisterImageBody = z.infer<typeof registerImageBodySchema>;
export type RemoveGalleryImageQuery = z.infer<typeof removeGalleryImageQuerySchema>;
