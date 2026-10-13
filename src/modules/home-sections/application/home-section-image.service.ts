import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { StoragePrefix, buildObjectKey } from '../../../infra/storage/index.js';
import { BadRequestError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  HOME_SECTION_ALLOWED_IMAGE_MIME,
  HOME_SECTION_IMAGE_URL_TTL_SECONDS,
  HOME_SECTION_KEYS,
  HOME_SECTION_MAX_IMAGE_BYTES,
  HOME_SECTION_UPLOAD_URL_TTL_SECONDS,
  homeSectionPage,
  type HomeSectionKey,
  type HomeSectionPage,
} from '../domain/home-section.constants.js';
import type { HomeSectionImageRepository } from '../infrastructure/home-section-image.repository.js';

export interface HomeSectionImageDTO {
  key: HomeSectionKey;
  page: HomeSectionPage;
  /** `null` = no image configured → the app shows its built-in icon. */
  imageUrl: string | null;
  updatedAt: string | null;
}

export interface HomeSectionActor {
  actorUserId: string;
  context?: AuditContext;
}

function isAllowedMime(mime: string): boolean {
  return (HOME_SECTION_ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
}

/**
 * Admin-managed images for the existing home-page section cards. Presigned
 * direct-to-R2 upload (`StoragePrefix.homeSectionImages`), the same
 * request-URL → PUT → register flow and validation as the ad slide images.
 * DB transactions never wrap a storage call; a replaced / removed object is
 * deleted best-effort afterwards.
 */
export class HomeSectionImageService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly images: HomeSectionImageRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'home-section-image-service' });
  }

  /** Every section key, in display order, with its image (or `null`). */
  async list(): Promise<HomeSectionImageDTO[]> {
    const rows = new Map((await this.images.listAll()).map((r) => [r.section_key, r]));
    return Promise.all(
      HOME_SECTION_KEYS.map(async (key) => {
        const row = rows.get(key);
        return {
          key,
          page: homeSectionPage(key),
          imageUrl: await resolveStorageUrlOrNull(
            this.storage,
            row?.image_key ?? null,
            HOME_SECTION_IMAGE_URL_TTL_SECONDS,
          ),
          updatedAt: row ? row.updated_at.toISOString() : null,
        };
      }),
    );
  }

  private async one(key: HomeSectionKey): Promise<HomeSectionImageDTO> {
    const row = await this.images.find(key);
    return {
      key,
      page: homeSectionPage(key),
      imageUrl: await resolveStorageUrlOrNull(
        this.storage,
        row?.image_key ?? null,
        HOME_SECTION_IMAGE_URL_TTL_SECONDS,
      ),
      updatedAt: row ? row.updated_at.toISOString() : null,
    };
  }

  async requestUploadUrl(
    key: HomeSectionKey,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    if (input.size > HOME_SECTION_MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${HOME_SECTION_MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!isAllowedMime(input.mimeType)) {
      throw new BadRequestError(
        `MIME type "${input.mimeType}" is not allowed for a section image`,
        {
          code: ErrorCode.UNSUPPORTED_FILE_TYPE,
        },
      );
    }
    const storageKey = buildObjectKey(
      `${StoragePrefix.homeSectionImages}/${key.toLowerCase()}`,
      input.filename,
    );
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: HOME_SECTION_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: HOME_SECTION_UPLOAD_URL_TTL_SECONDS,
    };
  }

  /** Attach (or replace) the section's image after the client's direct upload. */
  async registerImage(
    actor: HomeSectionActor,
    key: HomeSectionKey,
    input: { storageKey: string; mimeType: string },
  ): Promise<HomeSectionImageDTO> {
    // The key must be one THIS section's upload URL produced — never another
    // section's, another domain's, or an arbitrary bucket object.
    if (!input.storageKey.startsWith(`${StoragePrefix.homeSectionImages}/${key.toLowerCase()}/`)) {
      throw new BadRequestError('storage key does not belong to this home section', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    if (head.size > HOME_SECTION_MAX_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    if (!isAllowedMime(realMime)) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const previous = await this.images.find(key);
    await this.db.transaction(async (tx) => {
      await this.images.upsert(
        key,
        {
          imageKey: input.storageKey,
          storageProvider: this.storage.name,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.HOME_SECTION_IMAGE_UPDATED,
          entityType: AuditEntityType.HOME_SECTION,
          entityId: null,
          actorUserId: actor.actorUserId,
          metadata: { sectionKey: key, replaced: Boolean(previous), sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
    });

    if (previous && previous.image_key !== input.storageKey) {
      await this.deleteObject(previous.image_key, key, 'replaced');
    }
    return this.one(key);
  }

  /** Back to the built-in icon. No-op (not an error) when no image is set. */
  async removeImage(actor: HomeSectionActor, key: HomeSectionKey): Promise<HomeSectionImageDTO> {
    const previous = await this.images.find(key);
    if (!previous) return this.one(key);

    await this.db.transaction(async (tx) => {
      await this.images.remove(key, tx);
      await this.audit.record(
        {
          action: AuditAction.HOME_SECTION_IMAGE_REMOVED,
          entityType: AuditEntityType.HOME_SECTION,
          entityId: null,
          actorUserId: actor.actorUserId,
          metadata: { sectionKey: key },
          context: actor.context,
        },
        tx,
      );
    });
    await this.deleteObject(previous.image_key, key, 'removed');
    return this.one(key);
  }

  private async deleteObject(storageKey: string, key: HomeSectionKey, why: string): Promise<void> {
    try {
      await this.storage.delete(storageKey);
    } catch (err) {
      this.log.error(
        { err, sectionKey: key },
        `failed to delete ${why} home section image — needs a sweep`,
      );
    }
  }
}
