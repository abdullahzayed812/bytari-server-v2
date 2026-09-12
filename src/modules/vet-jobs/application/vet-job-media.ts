import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  VET_JOB_ALLOWED_DOCUMENT_MIME,
  VET_JOB_ALLOWED_IMAGE_MIME,
  VET_JOB_ATTACHMENT_URL_TTL_SECONDS,
  VET_JOB_MAX_ATTACHMENT_BYTES,
} from '../domain/vet-job.constants.js';

const UPLOAD_URL_TTL_SECONDS = 900;
const PREFIX = StoragePrefix.vetJobAttachments;
const ALLOWED_MIME = [...VET_JOB_ALLOWED_DOCUMENT_MIME, ...VET_JOB_ALLOWED_IMAGE_MIME];

export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Shared attachment handling for every Veterinarian Jobs entity (offer /
 * seeker profile / application) — a CV (PDF) and/or a profile photo (image).
 * One presign endpoint; `validateKey` verifies the key was really uploaded
 * (via `storage.head`) before it is persisted on a row, mirroring the
 * `vet-services` image pattern.
 */
export class VetJobMedia {
  constructor(private readonly storage: ObjectStorage) {}

  async presignUpload(input: { filename: string; mimeType: string; size: number }): Promise<PresignResult> {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > VET_JOB_MAX_ATTACHMENT_BYTES) {
      throw new BadRequestError(`attachment exceeds the ${VET_JOB_MAX_ATTACHMENT_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(input.mimeType)) {
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

  /** Verify a key belongs to this prefix and points at a real uploaded object. */
  async validateKey(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    if (!key.startsWith(`${PREFIX}/`)) {
      throw new BadRequestError('an attachment storage key is not a vet-jobs upload', {
        code: ErrorCode.VET_JOB_ATTACHMENT_INVALID,
      });
    }
    const head = await this.storage.head(key);
    if (!head) {
      throw new BadRequestError('an attachment was not uploaded', {
        code: ErrorCode.VET_JOB_ATTACHMENT_INVALID,
      });
    }
    if (head.size > VET_JOB_MAX_ATTACHMENT_BYTES) {
      throw new BadRequestError('an uploaded attachment exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    return key;
  }

  async resolveUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    return (
      this.storage.getPublicUrl(key) ??
      (await this.storage.getSignedUrl(key, {
        operation: 'get',
        expiresIn: VET_JOB_ATTACHMENT_URL_TTL_SECONDS,
      }))
    );
  }
}
