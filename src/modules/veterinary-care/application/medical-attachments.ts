import type { Logger } from 'pino';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  MEDICAL_ATTACHMENT_MAX_BYTES,
  MEDICAL_ATTACHMENT_MIME,
  MEDICAL_ATTACHMENTS_MAX,
} from '../domain/veterinary-care.constants.js';
import type { MedicalRecord } from '../domain/veterinary-care.types.js';

const UPLOAD_URL_TTL_SECONDS = 600;
const READ_URL_TTL_SECONDS = 3600;

type AllowedMime = (typeof MEDICAL_ATTACHMENT_MIME)[number];

/**
 * Medical-record attachments (legacy `prescriptionImage` / `fileUrls`):
 * presigned direct-to-R2 upload, then the record references the key.
 *
 * Keys are minted under `medical-records/<organizationId>/…`, and a record may
 * only reference keys under ITS clinic's prefix that really exist in storage —
 * so Clinic A can never attach (or expose through a signed URL) an object
 * uploaded by Clinic B or by any other feature. Medical files are private:
 * always served through short-lived signed URLs.
 */
export class MedicalAttachments {
  private readonly log: Logger;

  constructor(
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'medical-attachments' });
  }

  private prefixFor(organizationId: string): string {
    return `${StoragePrefix.medicalAttachments}/${organizationId}`;
  }

  async requestUploadUrl(
    organizationId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MEDICAL_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestError(`file exceeds the ${MEDICAL_ATTACHMENT_MAX_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!MEDICAL_ATTACHMENT_MIME.includes(input.mimeType as AllowedMime)) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    const storageKey = buildObjectKey(this.prefixFor(organizationId), input.filename);
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

  /**
   * Validate the keys a create / update wants to reference. Keys the record
   * already holds are accepted as-is (re-saving an edit); every NEW key must be
   * under this clinic's prefix and exist with an allowed type / size.
   */
  async assertUsable(
    organizationId: string,
    keys: string[],
    alreadyAttached: readonly string[] = [],
  ): Promise<void> {
    if (keys.length > MEDICAL_ATTACHMENTS_MAX + 1) {
      throw new BadRequestError(`at most ${MEDICAL_ATTACHMENTS_MAX} attachments are allowed`, {
        code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
      });
    }
    const prefix = `${this.prefixFor(organizationId)}/`;
    for (const key of keys) {
      if (alreadyAttached.includes(key)) continue;
      if (!key.startsWith(prefix)) {
        throw new ConflictError('storage key does not belong to this clinic’s medical uploads', {
          code: ErrorCode.STORAGE_KEY_MISMATCH,
        });
      }
      const head = await this.storage.head(key);
      if (!head) {
        throw new BadRequestError('no uploaded object exists at that storage key', {
          code: ErrorCode.STORAGE_OBJECT_MISSING,
        });
      }
      if (head.size > MEDICAL_ATTACHMENT_MAX_BYTES) {
        throw new BadRequestError('the uploaded object exceeds the size limit', {
          code: ErrorCode.FILE_TOO_LARGE,
        });
      }
      const mime = head.contentType ?? '';
      if (mime && !MEDICAL_ATTACHMENT_MIME.includes(mime as AllowedMime)) {
        throw new BadRequestError(`the uploaded object's type "${mime}" is not allowed`, {
          code: ErrorCode.UNSUPPORTED_FILE_TYPE,
        });
      }
    }
  }

  private async url(key: string): Promise<string | null> {
    return this.storage.getSignedUrl(key, { operation: 'get', expiresIn: READ_URL_TTL_SECONDS });
  }

  async resolve(
    record: Pick<MedicalRecord, 'prescriptionKey' | 'attachmentKeys'>,
  ): Promise<{ prescriptionUrl: string | null; attachmentUrls: string[] }> {
    const [prescriptionUrl, ...attachmentUrls] = await Promise.all([
      record.prescriptionKey ? this.url(record.prescriptionKey) : Promise.resolve(null),
      ...record.attachmentKeys.map((k) => this.url(k)),
    ]);
    return {
      prescriptionUrl: prescriptionUrl ?? null,
      attachmentUrls: attachmentUrls.filter((u): u is string => u !== null),
    };
  }

  /** Best-effort removal of objects no longer referenced (never fails the request). */
  async deleteQuietly(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.log.error({ err }, 'failed to delete a medical attachment — needs a sweep');
      }
    }
  }
}
