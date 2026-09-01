import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  ALLOWED_IMAGE_MIME,
  IMAGE_URL_TTL_SECONDS,
  MAX_IMAGE_BYTES,
  SUBTITLE_MAX,
  TITLE_MAX,
} from '../domain/home-ad.constants.js';
import type { HomeAd, HomeAdDTO, ListHomeAdsFilter } from '../domain/home-ad.types.js';
import type { HomeAdRepository } from '../infrastructure/home-ad.repository.js';

export interface HomeAdActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateHomeAdInput {
  title: string;
  subtitle?: string | null;
  sortOrder?: number;
}

export interface UpdateHomeAdInput {
  title?: string;
  subtitle?: string | null;
  sortOrder?: number;
}

const UPLOAD_URL_TTL_SECONDS = 600;

function assertTitle(title: string): void {
  if (title.trim().length === 0 || title.length > TITLE_MAX) {
    throw new BadRequestError(`title must be 1-${TITLE_MAX} characters`);
  }
}

function assertSubtitle(subtitle: string | null | undefined): void {
  if (subtitle && subtitle.length > SUBTITLE_MAX) {
    throw new BadRequestError(`subtitle must be at most ${SUBTITLE_MAX} characters`);
  }
}

/**
 * Home-ad (banner carousel) lifecycle + image. Authorization is done by the
 * route `authorize('home_ad.manage')` middleware (ADMIN override / HOME_AD
 * supervisor domain); this service enforces field rules and the
 * public-visibility rule (active, not-deleted, imaged).
 *
 * Storage: presigned direct-to-R2 upload, same convention as the `content`
 * module. The DB transaction is never held open across a storage call.
 */
export class HomeAdService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly homeAds: HomeAdRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'home-ad-service' });
  }

  private async load(id: string): Promise<HomeAd> {
    const ad = await this.homeAds.findById(id);
    if (!ad) throw new NotFoundError('Home ad not found');
    return ad;
  }

  private async dto(ad: HomeAd): Promise<HomeAdDTO> {
    const imageUrl = ad.imageStorageKey ? await this.resolveImageUrl(ad.imageStorageKey) : null;
    return {
      id: ad.id,
      title: ad.title,
      subtitle: ad.subtitle,
      imageUrl,
      sortOrder: ad.sortOrder,
      isActive: ad.isActive,
      createdAt: ad.createdAt,
      updatedAt: ad.updatedAt,
    };
  }

  private async resolveImageUrl(key: string): Promise<string> {
    const publicUrl = this.storage.getPublicUrl(key);
    if (publicUrl) return publicUrl;
    return this.storage.getSignedUrl(key, { operation: 'get', expiresIn: IMAGE_URL_TTL_SECONDS });
  }

  // --- create / update ----------------------------------------

  async create(actor: HomeAdActor, input: CreateHomeAdInput): Promise<HomeAdDTO> {
    assertTitle(input.title);
    assertSubtitle(input.subtitle);

    const created = await this.db.transaction(async (tx) => {
      const ad = await this.homeAds.create(
        {
          title: input.title,
          subtitle: input.subtitle ?? null,
          sortOrder: input.sortOrder ?? 0,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.HOME_AD_CREATED,
          entityType: AuditEntityType.HOME_AD,
          entityId: ad.id,
          actorUserId: actor.actorUserId,
          metadata: { homeAdId: ad.id },
          context: actor.context,
        },
        tx,
      );
      return ad;
    });

    return this.dto(created);
  }

  async update(actor: HomeAdActor, id: string, input: UpdateHomeAdInput): Promise<HomeAdDTO> {
    await this.load(id);
    if (input.title !== undefined) assertTitle(input.title);
    if (input.subtitle !== undefined) assertSubtitle(input.subtitle);

    const updated = await this.db.transaction(async (tx) => {
      const ad = await this.homeAds.update(
        id,
        {
          title: input.title,
          subtitle: input.subtitle,
          sortOrder: input.sortOrder,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.HOME_AD_UPDATED,
          entityType: AuditEntityType.HOME_AD,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { homeAdId: id },
          context: actor.context,
        },
        tx,
      );
      return ad;
    });

    return this.dto(updated);
  }

  async setActive(actor: HomeAdActor, id: string, isActive: boolean): Promise<HomeAdDTO> {
    const existing = await this.load(id);
    if (isActive && !existing.imageStorageKey) {
      throw new BadRequestError('cannot activate a home ad with no image');
    }
    if (existing.isActive === isActive) return this.dto(existing); // idempotent

    const updated = await this.db.transaction(async (tx) => {
      const ad = await this.homeAds.setActive(id, isActive, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: isActive ? AuditAction.HOME_AD_ACTIVATED : AuditAction.HOME_AD_DEACTIVATED,
          entityType: AuditEntityType.HOME_AD,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { homeAdId: id },
          context: actor.context,
        },
        tx,
      );
      return ad;
    });

    return this.dto(updated);
  }

  async setDeleted(actor: HomeAdActor, id: string, deleted: boolean): Promise<HomeAdDTO> {
    const existing = await this.load(id);
    if ((existing.deletedAt !== null) === deleted) return this.dto(existing); // idempotent

    const updated = await this.db.transaction(async (tx) => {
      const ad = await this.homeAds.setDeleted(id, deleted, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: deleted ? AuditAction.HOME_AD_DELETED : AuditAction.HOME_AD_RESTORED,
          entityType: AuditEntityType.HOME_AD,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { homeAdId: id },
          context: actor.context,
        },
        tx,
      );
      return ad;
    });

    return this.dto(updated);
  }

  // --- reads -----------------------------------------------

  async getAdmin(id: string): Promise<HomeAdDTO> {
    return this.dto(await this.load(id));
  }

  async listAdmin(filter: ListHomeAdsFilter): Promise<{ items: HomeAdDTO[]; total: number }> {
    const { items, total } = await this.homeAds.listAdmin(filter);
    return { items: await Promise.all(items.map((ad) => this.dto(ad))), total };
  }

  async listPublic(): Promise<HomeAdDTO[]> {
    const items = await this.homeAds.listPublic();
    return Promise.all(items.map((ad) => this.dto(ad)));
  }

  // --- image -----------------------------------------------

  async requestUploadUrl(
    id: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.load(id);
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(
        `MIME type "${input.mimeType}" is not allowed for a home ad image`,
        {
          code: ErrorCode.UNSUPPORTED_FILE_TYPE,
        },
      );
    }

    const storageKey = buildObjectKey(StoragePrefix.homeAds, input.filename);
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

  async registerImage(
    actor: HomeAdActor,
    id: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<HomeAdDTO> {
    const existing = await this.load(id);
    if (!input.storageKey.startsWith(`${StoragePrefix.homeAds}/`)) {
      throw new BadRequestError('storage key does not belong to home ad images', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }

    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    if (head.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(realMime as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const previousKey = existing.imageStorageKey;
    const updated = await this.db.transaction(async (tx) => {
      const ad = await this.homeAds.setImage(
        id,
        {
          imageStorageKey: input.storageKey,
          imageStorageProvider: this.storage.name,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.HOME_AD_IMAGE_UPDATED,
          entityType: AuditEntityType.HOME_AD,
          entityId: id,
          actorUserId: actor.actorUserId,
          // NB: no storage key / URL / credentials in audit metadata.
          metadata: { homeAdId: id, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
      return ad;
    });

    // Best-effort cleanup of the replaced object AFTER commit (§28 convention).
    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error(
          { err, homeAdId: id },
          'failed to delete replaced home-ad image — needs a sweep',
        );
      }
    }

    return this.dto(updated);
  }
}
