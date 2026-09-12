import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  SYNDICATE_ALLOWED_IMAGE_MIME,
  SYNDICATE_IMAGE_URL_TTL_SECONDS,
  SYNDICATE_MAX_ATTACHMENT_BYTES,
  SYNDICATE_MAX_ATTACHMENTS,
  SYNDICATE_MAX_IMAGE_BYTES,
} from '../domain/syndicate.constants.js';

const UPLOAD_URL_TTL_SECONDS = 900;

export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export type SyndicateMediaKind = 'LOGO' | 'ANNOUNCEMENT_IMAGE' | 'SUBMISSION_ATTACHMENT';

const PREFIX_BY_KIND: Record<SyndicateMediaKind, string> = {
  LOGO: StoragePrefix.syndicateLogos,
  ANNOUNCEMENT_IMAGE: StoragePrefix.syndicateAnnouncementImages,
  SUBMISSION_ATTACHMENT: StoragePrefix.syndicateSubmissionAttachments,
};
const MAX_BYTES_BY_KIND: Record<SyndicateMediaKind, number> = {
  LOGO: SYNDICATE_MAX_IMAGE_BYTES,
  ANNOUNCEMENT_IMAGE: SYNDICATE_MAX_IMAGE_BYTES,
  SUBMISSION_ATTACHMENT: SYNDICATE_MAX_ATTACHMENT_BYTES,
};

/**
 * Image handling for every Veterinary Syndicates entity — the syndicate logo,
 * an announcement's cover image, and a request/inquiry's attachments (up to
 * {@link SYNDICATE_MAX_ATTACHMENTS}). One presign endpoint per kind;
 * `validateKey` verifies the key was really uploaded (via `storage.head`)
 * before it is persisted, mirroring the `vet-jobs` / `vet-courses` pattern.
 */
export class SyndicateMedia {
  constructor(private readonly storage: ObjectStorage) {}

  async presignUpload(
    kind: SyndicateMediaKind,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<PresignResult> {
    const maxBytes = MAX_BYTES_BY_KIND[kind];
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > maxBytes) {
      throw new BadRequestError(`file exceeds the ${maxBytes}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(SYNDICATE_ALLOWED_IMAGE_MIME as readonly string[]).includes(input.mimeType)) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    const storageKey = buildObjectKey(PREFIX_BY_KIND[kind], input.filename);
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

  /** Verify a single key belongs to `kind`'s prefix and points at a real uploaded object. */
  async validateKey(kind: SyndicateMediaKind, key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    const prefix = PREFIX_BY_KIND[kind];
    if (!key.startsWith(`${prefix}/`)) {
      throw new BadRequestError('a storage key does not belong to this upload kind', {
        code: ErrorCode.SYNDICATE_ATTACHMENT_INVALID,
      });
    }
    const head = await this.storage.head(key);
    if (!head) {
      throw new BadRequestError('a file was not uploaded', {
        code: ErrorCode.SYNDICATE_ATTACHMENT_INVALID,
      });
    }
    if (head.size > MAX_BYTES_BY_KIND[kind]) {
      throw new BadRequestError('an uploaded file exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    return key;
  }

  /** Validate a submission's attachment list — at most {@link SYNDICATE_MAX_ATTACHMENTS}. */
  async validateAttachmentKeys(keys: string[] | undefined): Promise<string[]> {
    const list = keys ?? [];
    if (list.length > SYNDICATE_MAX_ATTACHMENTS) {
      throw new BadRequestError(`at most ${SYNDICATE_MAX_ATTACHMENTS} attachments are allowed`, {
        code: ErrorCode.SYNDICATE_TOO_MANY_ATTACHMENTS,
      });
    }
    const validated: string[] = [];
    for (const key of list) {
      const ok = await this.validateKey('SUBMISSION_ATTACHMENT', key);
      if (ok) validated.push(ok);
    }
    return validated;
  }

  async resolveUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    return (
      this.storage.getPublicUrl(key) ??
      (await this.storage.getSignedUrl(key, {
        operation: 'get',
        expiresIn: SYNDICATE_IMAGE_URL_TTL_SECONDS,
      }))
    );
  }

  async resolveUrls(keys: string[]): Promise<string[]> {
    return Promise.all(keys.map((k) => this.resolveUrl(k))).then((urls) =>
      urls.filter((u): u is string => u !== null),
    );
  }
}
