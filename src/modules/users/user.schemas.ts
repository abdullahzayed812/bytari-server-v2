import { z } from 'zod';
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
