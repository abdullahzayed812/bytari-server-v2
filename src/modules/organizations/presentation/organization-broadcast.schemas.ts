import { z } from 'zod';
import { linkUrlSchema } from '../../../shared/validation/link-url.js';

export const organizationBroadcastParamSchema = z.object({ organizationId: z.string().uuid() });

export const sendOrganizationBroadcastBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(1000),
  imageStorageKey: z.string().trim().min(1).max(1000).nullable().optional(),
  linkUrl: linkUrlSchema.nullable().optional(),
  /** `CLINIC_VISITORS` = the legacy "إرسال رسالة للمراجعين" (CLINIC only); default followers. */
  audience: z.enum(['FOLLOWERS', 'CLINIC_VISITORS']).optional(),
});
export type SendOrganizationBroadcastBody = z.infer<typeof sendOrganizationBroadcastBodySchema>;

export const organizationBroadcastImageUploadUrlBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().positive(),
});
export type OrganizationBroadcastImageUploadUrlBody = z.infer<
  typeof organizationBroadcastImageUploadUrlBodySchema
>;
