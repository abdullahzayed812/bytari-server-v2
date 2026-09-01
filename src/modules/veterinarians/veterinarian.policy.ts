import { BadRequestError, ConflictError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { VetApplicationDocumentKind } from './veterinarian.types.js';

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const IMAGE_AND_PDF_MIME = [...IMAGE_MIME, 'application/pdf'] as const;

/** Hard ceiling for any single application document (5 MiB). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Allowed MIME types per document kind. */
export const ALLOWED_DOCUMENT_MIME: Record<VetApplicationDocumentKind, readonly string[]> = {
  LICENSE_OR_ID: IMAGE_AND_PDF_MIME,
  ADDITIONAL_ID: IMAGE_AND_PDF_MIME,
  STUDENT_ID_FRONT: IMAGE_MIME,
  STUDENT_ID_BACK: IMAGE_MIME,
};

/**
 * Pure veterinarian-application-document rules — no I/O. Mirrors
 * `ContentPolicy` / `UserPolicy`: declared values are checked before a
 * presigned URL is issued, then the object's REAL size / type (from
 * `storage.head()`) are re-checked when the application is submitted.
 */
export const VeterinarianPolicy = {
  assertDocumentUploadRequest(
    kind: VetApplicationDocumentKind,
    declaredMime: string,
    declaredSize: number,
  ): void {
    if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (declaredSize > MAX_DOCUMENT_BYTES) {
      throw new BadRequestError(`file exceeds the ${MAX_DOCUMENT_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_DOCUMENT_MIME[kind].includes(declaredMime)) {
      throw new BadRequestError(`MIME type "${declaredMime}" is not allowed for a ${kind} document`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  },

  /** Re-validate against the object's REAL size / type after upload. */
  assertRegisteredDocument(
    kind: VetApplicationDocumentKind,
    realMime: string,
    realSize: number,
  ): void {
    if (realSize > MAX_DOCUMENT_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_DOCUMENT_MIME[kind].includes(realMime)) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  },

  /** A storage key the server issued for THIS purpose must sit under its prefix. */
  assertKeyBelongsToPrefix(key: string, expectedPrefix: string): void {
    if (!key.startsWith(`${expectedPrefix}/`)) {
      throw new ConflictError('storage key does not belong to a veterinarian document upload', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
  },
} as const;
