import { BadRequestError, ConflictError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';

/** Allowed avatar MIME types. */
export const ALLOWED_AVATAR_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Hard ceiling for an avatar image (5 MiB). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Pure avatar-upload rules — no I/O. Mirrors `ContentPolicy` (content module):
 * declared values are checked before a presigned URL is issued, then the
 * object's REAL size / type (from `storage.head()`) are re-checked on finalize.
 */
export const UserPolicy = {
  assertAvatarUploadRequest(mimeType: string, size: number): void {
    if (!Number.isInteger(size) || size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (size > MAX_AVATAR_BYTES) {
      throw new BadRequestError(`avatar exceeds the ${MAX_AVATAR_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_AVATAR_MIME.includes(mimeType as (typeof ALLOWED_AVATAR_MIME)[number])) {
      throw new BadRequestError(`MIME type "${mimeType}" is not allowed for an avatar`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  },

  /** Re-validate against the object's REAL size / type after upload. */
  assertRegisteredAvatar(realMimeType: string, realSize: number): void {
    if (realSize > MAX_AVATAR_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_AVATAR_MIME.includes(realMimeType as (typeof ALLOWED_AVATAR_MIME)[number])) {
      throw new BadRequestError(`the uploaded object's type "${realMimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  },

  /** A storage key the server issued for this purpose must sit under its prefix. */
  assertKeyBelongsToPrefix(key: string, expectedPrefix: string): void {
    if (!key.startsWith(`${expectedPrefix}/`)) {
      throw new ConflictError('storage key does not belong to this upload target', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
  },
} as const;
