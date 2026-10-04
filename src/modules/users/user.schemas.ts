import { z } from 'zod';
import { nameSchema, phoneSchema } from '../../shared/validation/common.js';
import { countryCodeSchema, governorateSchema } from '../../shared/validation/geography.js';
import { MAX_AVATAR_BYTES } from './user.policy.js';

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
// A generic string, not a Zod enum: the MIME allowlist is enforced by
// `UserPolicy` (which returns a stable 400 UNSUPPORTED_FILE_TYPE), matching
// the content module's pattern of keeping allow-list checks in one place.
const mimeType = z.string().trim().min(1).max(255);

/** New endpoint, no legacy client — `.strict()` rejects unknown fields. */
export const avatarUploadUrlBodySchema = z
  .object({
    filename,
    mimeType,
    size: z.number().int().positive().max(MAX_AVATAR_BYTES),
  })
  .strict();
export type AvatarUploadUrlBody = z.infer<typeof avatarUploadUrlBodySchema>;

export const finalizeAvatarBodySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(1024),
    mimeType,
    filename,
  })
  .strict();
export type FinalizeAvatarBody = z.infer<typeof finalizeAvatarBodySchema>;

/**
 * `PATCH /users/me` — the signed-in user's own profile ("تعديل الملف الشخصي").
 * A strict allow-list: the email (needs re-verification), status, roles,
 * veterinarian/trader status, avatar (own endpoint) and password (own audited
 * `POST /auth/change-password`) are NOT writable here.
 */
export const updateMyProfileBodySchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    whatsapp: phoneSchema.nullable().optional(),
    country: countryCodeSchema.nullable().optional(),
    governorate: governorateSchema.nullable().optional(),
    specialization: z.string().trim().min(1).max(120).nullable().optional(),
    bio: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  // An emptied "نبذة عني" is stored as NULL, never as ''.
  .transform((v) => (v.bio === '' ? { ...v, bio: null } : v));
export type UpdateMyProfileBody = z.infer<typeof updateMyProfileBodySchema>;
