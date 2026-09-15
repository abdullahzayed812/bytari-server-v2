import { buildObjectKey, type ObjectStorage } from '../../../infra/storage/index.js';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  ALLOWED_MESSAGE_IMAGE_MIME,
  MAX_MESSAGE_IMAGE_BYTES,
  MESSAGE_IMAGE_URL_TTL_SECONDS,
} from '../domain/thread.constants.js';

const UPLOAD_URL_TTL_SECONDS = 600;

export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Shared image handling for a CONSULTATION / INQUIRY's initial-message
 * attachments — modeled on `vet-services/application/vet-service-media.ts`,
 * generic over the storage prefix so one instance serves each kind. One
 * presign endpoint per kind; `validateKeys` verifies each key was really
 * uploaded (via `storage.head`) and belongs to this instance's prefix before
 * it is persisted on a message row.
 */
export class ThreadAttachmentMedia {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly prefix: string,
  ) {}

  async presignUpload(input: {
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<PresignResult> {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_MESSAGE_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_MESSAGE_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (
      !ALLOWED_MESSAGE_IMAGE_MIME.includes(
        input.mimeType as (typeof ALLOWED_MESSAGE_IMAGE_MIME)[number],
      )
    ) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    const storageKey = buildObjectKey(this.prefix, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /** Verify each key belongs to this prefix and points at a real uploaded object. */
  async validateKeys(keys: string[], max: number): Promise<string[]> {
    if (keys.length === 0) return [];
    const unique = [...new Set(keys)];
    if (unique.length > max) {
      throw new BadRequestError(`at most ${max} images are allowed`);
    }
    for (const key of unique) {
      if (!key.startsWith(`${this.prefix}/`)) {
        throw new BadRequestError('an image storage key does not belong to this attachment slot', {
          code: ErrorCode.STORAGE_KEY_MISMATCH,
        });
      }
      const head = await this.storage.head(key);
      if (!head) {
        throw new BadRequestError('no uploaded object exists at that storage key', {
          code: ErrorCode.STORAGE_OBJECT_MISSING,
        });
      }
      if (head.size > MAX_MESSAGE_IMAGE_BYTES) {
        throw new BadRequestError('an uploaded image exceeds the size limit', {
          code: ErrorCode.FILE_TOO_LARGE,
        });
      }
      const realMime = head.contentType ?? '';
      if (
        !ALLOWED_MESSAGE_IMAGE_MIME.includes(realMime as (typeof ALLOWED_MESSAGE_IMAGE_MIME)[number])
      ) {
        throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
          code: ErrorCode.UNSUPPORTED_FILE_TYPE,
        });
      }
    }
    return unique;
  }

  async resolveUrls(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const urls = await Promise.all(
      keys.map(
        async (key) =>
          this.storage.getPublicUrl(key) ??
          (await this.storage.getSignedUrl(key, {
            operation: 'get',
            expiresIn: MESSAGE_IMAGE_URL_TTL_SECONDS,
          })),
      ),
    );
    return urls.filter((u): u is string => u !== null);
  }
}
