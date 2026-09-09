import {
  buildObjectKey,
  StoragePrefix,
  type ObjectStorage,
} from '../../../infra/storage/index.js';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { VET_SERVICE_IMAGE_URL_TTL_SECONDS } from '../domain/vet-service.constants.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MiB
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
const UPLOAD_URL_TTL_SECONDS = 900;
const PREFIX = StoragePrefix.vetServiceImages;

export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Shared image handling for every vet-service entity (listing / request / offer
 * / listing-request). One presign endpoint; keys carry the
 * `vet-services/YYYY/MM/<uuid>` convention; `validateKeys` verifies each key was
 * really uploaded (via `storage.head`) before it is persisted on a row.
 */
export class VetServiceMedia {
  constructor(private readonly storage: ObjectStorage) {}

  async presignUpload(input: {
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<PresignResult> {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    const storageKey = buildObjectKey(PREFIX, input.filename);
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
      throw new BadRequestError(`at most ${max} images are allowed`, {
        code: ErrorCode.VET_SERVICE_IMAGE_INVALID,
      });
    }
    for (const key of unique) {
      if (!key.startsWith(`${PREFIX}/`)) {
        throw new BadRequestError('an image storage key is not a vet-service upload', {
          code: ErrorCode.VET_SERVICE_IMAGE_INVALID,
        });
      }
      const head = await this.storage.head(key);
      if (!head) {
        throw new BadRequestError('an image was not uploaded', {
          code: ErrorCode.VET_SERVICE_IMAGE_INVALID,
        });
      }
      if (head.size > MAX_IMAGE_BYTES) {
        throw new BadRequestError('an uploaded image exceeds the size limit', {
          code: ErrorCode.FILE_TOO_LARGE,
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
            expiresIn: VET_SERVICE_IMAGE_URL_TTL_SECONDS,
          })),
      ),
    );
    return urls.filter((u): u is string => u !== null);
  }
}
