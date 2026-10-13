import { z } from 'zod';
import {
  HOME_SECTION_ALLOWED_IMAGE_MIME,
  HOME_SECTION_KEYS,
  HOME_SECTION_MAX_IMAGE_BYTES,
} from '../domain/home-section.constants.js';

export const homeSectionKeyParamSchema = z.object({ key: z.enum(HOME_SECTION_KEYS) });
export type HomeSectionKeyParams = z.infer<typeof homeSectionKeyParamSchema>;

export const homeSectionUploadUrlBodySchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum(HOME_SECTION_ALLOWED_IMAGE_MIME),
    size: z.number().int().positive().max(HOME_SECTION_MAX_IMAGE_BYTES),
  })
  .strict();
export type HomeSectionUploadUrlBody = z.infer<typeof homeSectionUploadUrlBodySchema>;

export const homeSectionRegisterImageBodySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(1024),
    mimeType: z.enum(HOME_SECTION_ALLOWED_IMAGE_MIME),
  })
  .strict();
export type HomeSectionRegisterImageBody = z.infer<typeof homeSectionRegisterImageBodySchema>;
