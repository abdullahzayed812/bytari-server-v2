import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { ALLOWED_MIME, MAX_FILE_BYTES } from './content.constants.js';
import type { ContentFileKind, ContentStatus } from './content.constants.js';

/**
 * Pure content rules. Anything needing the DB (authorization, existence) is in
 * the service; this only encodes the lifecycle graph and file constraints.
 *
 * Lifecycle (DRAFT ⇄ PUBLISHED ⇄ ARCHIVED):
 *   publish:  DRAFT | ARCHIVED → PUBLISHED   (no-op if already PUBLISHED)
 *   archive:  DRAFT | PUBLISHED → ARCHIVED   (no-op if already ARCHIVED)
 * There is no direct DRAFT→ARCHIVED restriction — archiving a draft is allowed
 * (it removes an unfinished item from the managers' active view without
 * deletion). Documented in ARCHITECTURE.md §17.
 */
export const ContentPolicy = {
  /** @returns `true` if the status actually changes, `false` if it is a no-op. */
  assertCanPublish(current: ContentStatus): boolean {
    if (current === 'PUBLISHED') return false;
    return true;
  },

  assertCanArchive(current: ContentStatus): boolean {
    if (current === 'ARCHIVED') return false;
    return true;
  },

  assertFileUploadRequest(kind: ContentFileKind, declaredMime: string, declaredSize: number): void {
    if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (declaredSize > MAX_FILE_BYTES) {
      throw new BadRequestError(`file exceeds the ${MAX_FILE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_MIME[kind].includes(declaredMime)) {
      throw new BadRequestError(`MIME type "${declaredMime}" is not allowed for a ${kind} file`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  },

  /** Re-validate against the object's REAL size / type after upload. */
  assertRegisteredFile(kind: ContentFileKind, realMime: string, realSize: number): void {
    if (realSize > MAX_FILE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_MIME[kind].includes(realMime)) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  },

  /** A storage key the server issued for THIS content must sit under its prefix. */
  assertKeyBelongsToPrefix(key: string, expectedPrefix: string): void {
    if (!key.startsWith(`${expectedPrefix}/`)) {
      throw new ConflictError('storage key does not belong to this content', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
  },
} as const;
