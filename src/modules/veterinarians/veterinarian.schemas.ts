import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { MAX_DOCUMENT_BYTES } from './veterinarian.policy.js';
import { VET_APPLICATION_DOCUMENT_KINDS, VET_APPLICATION_SUB_TYPES } from './veterinarian.types.js';

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

/** New endpoint, no legacy client — `.strict()` rejects unknown fields. */
export const documentUploadUrlBodySchema = z
  .object({
    kind: z.enum(VET_APPLICATION_DOCUMENT_KINDS),
    filename,
    mimeType,
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  })
  .strict();
export type DocumentUploadUrlBody = z.infer<typeof documentUploadUrlBodySchema>;

const applyDocument = z
  .object({
    kind: z.enum(VET_APPLICATION_DOCUMENT_KINDS),
    storageKey: z.string().trim().min(1).max(1024),
    filename,
    mimeType,
  })
  .strict();

// Kept NON-strict (matches its existing permissive style): unknown / privileged
// keys (e.g. a client-supplied `status`, `decidedBy`) are silently stripped.
export const applyBodySchema = z
  .object({
    note: z.string().trim().max(1000).optional(),
    subType: z.enum(VET_APPLICATION_SUB_TYPES).default('VETERINARIAN'),
    documents: z.array(applyDocument).max(2).default([]),
  })
  .superRefine((v, ctx) => {
    const kinds = v.documents.map((d) => d.kind);
    if (v.subType === 'VETERINARIAN') {
      if (!kinds.includes('LICENSE_OR_ID')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documents'],
          message: 'A LICENSE_OR_ID document is required for a VETERINARIAN application',
        });
      }
      if (kinds.includes('STUDENT_ID_FRONT') || kinds.includes('STUDENT_ID_BACK')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documents'],
          message: 'Student ID documents are not allowed for a VETERINARIAN application',
        });
      }
    } else {
      if (!kinds.includes('STUDENT_ID_FRONT') || !kinds.includes('STUDENT_ID_BACK')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documents'],
          message:
            'Both STUDENT_ID_FRONT and STUDENT_ID_BACK documents are required for a STUDENT application',
        });
      }
      if (kinds.includes('LICENSE_OR_ID') || kinds.includes('ADDITIONAL_ID')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documents'],
          message: 'License / ID documents are not allowed for a STUDENT application',
        });
      }
    }
  });
export type ApplyBody = z.infer<typeof applyBodySchema>;

export const rejectBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type RejectBody = z.infer<typeof rejectBodySchema>;

export const pendingQuerySchema = paginationQuerySchema;
export type PendingQuery = z.infer<typeof pendingQuerySchema>;
