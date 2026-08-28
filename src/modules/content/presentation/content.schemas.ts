import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  AUTHOR_MAX,
  BODY_MAX,
  CONTENT_FILE_KINDS,
  CONTENT_STATUSES,
  CONTENT_TYPES,
  DESCRIPTION_MAX,
  MAX_FILE_BYTES,
  TITLE_MAX,
} from '../domain/content.constants.js';

export const contentIdParamSchema = z.object({ contentId: z.string().uuid() });
export const contentFileParamSchema = z.object({
  contentId: z.string().uuid(),
  fileId: z.string().uuid(),
});
export const categoryIdParamSchema = z.object({ categoryId: z.string().uuid() });

const title = z.string().trim().min(1).max(TITLE_MAX);
const description = z.string().trim().min(1).max(DESCRIPTION_MAX);
const body = z.string().max(BODY_MAX);
const authorName = z.string().trim().min(1).max(AUTHOR_MAX);
const categoryIds = z.array(z.string().uuid()).max(20);

/** `createdBy` / `status` / `publishedAt` are server-controlled — `.strict()` rejects them. */
export const createContentBodySchema = z
  .object({
    type: z.enum(CONTENT_TYPES),
    title,
    description: description.nullable().optional(),
    body: body.nullable().optional(),
    authorName: authorName.nullable().optional(),
    categoryIds: categoryIds.optional(),
  })
  .strict();

export const updateContentBodySchema = z
  .object({
    title: title.optional(),
    description: description.nullable().optional(),
    body: body.nullable().optional(),
    authorName: authorName.nullable().optional(),
    categoryIds: categoryIds.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listPublicContentQuerySchema = paginationQuerySchema.extend({
  type: z.enum(CONTENT_TYPES).optional(),
  categoryId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export const listAdminContentQuerySchema = listPublicContentQuerySchema.extend({
  status: z.enum(CONTENT_STATUSES).optional(),
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
  // no path separators / control chars — the server generates the real key anyway
  .refine((v) => !v.includes('/') && !v.includes('\\') && !hasControlChar(v), {
    message: 'filename must not contain path separators or control characters',
  });
const mimeType = z.string().trim().min(1).max(255);

export const uploadUrlBodySchema = z
  .object({
    kind: z.enum(CONTENT_FILE_KINDS),
    filename,
    mimeType,
    size: z.number().int().positive().max(MAX_FILE_BYTES),
  })
  .strict();

export const registerFileBodySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(1024),
    kind: z.enum(CONTENT_FILE_KINDS),
    filename,
    mimeType,
    checksum: z.string().trim().min(1).max(255).nullable().optional(),
  })
  .strict();

const slug = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'slug must be lowercase kebab-case');

export const createCategoryBodySchema = z
  .object({
    slug,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();

export const updateCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export type CreateContentBody = z.infer<typeof createContentBodySchema>;
export type UpdateContentBody = z.infer<typeof updateContentBodySchema>;
export type ListPublicContentQuery = z.infer<typeof listPublicContentQuerySchema>;
export type ListAdminContentQuery = z.infer<typeof listAdminContentQuerySchema>;
export type UploadUrlBody = z.infer<typeof uploadUrlBodySchema>;
export type RegisterFileBody = z.infer<typeof registerFileBodySchema>;
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;
