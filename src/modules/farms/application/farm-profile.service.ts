import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, InternalError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  PoultryOpsAuditAction,
  PoultryOpsAuditEntity,
  type FarmCategory,
} from '../domain/poultry-ops.constants.js';
import {
  emptyFarmProfile,
  type FarmProfile,
  type UpdateFarmProfileInput,
} from '../domain/poultry-ops.types.js';
import type { FarmProfileRepository } from '../infrastructure/farm-profile.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;

/**
 * The Farm Details header: image / address / capacity / establishment date /
 * category. These columns live on `farm_details` (same "extension point"
 * pattern the CLINIC / OFFICE / STORE directory profiles use). Authorization is
 * the route guard `authorizeOrg('organization.update')` + a FARM type gate.
 */
export class FarmProfileService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly profiles: FarmProfileRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'farm-profile-service' });
  }

  private async resolveImageUrl(key: string | null): Promise<string | null> {
    if (!key) return null;
    return (
      this.storage.getPublicUrl(key) ??
      (await this.storage.getSignedUrl(key, { operation: 'get', expiresIn: IMAGE_URL_TTL_SECONDS }))
    );
  }

  async getProfile(organizationId: string): Promise<FarmProfile> {
    const row = await this.profiles.findByOrganizationId(organizationId);
    if (!row) return { ...emptyFarmProfile };
    return {
      imageUrl: await this.resolveImageUrl(row.image_key),
      address: row.address,
      capacity: row.capacity === null ? null : Number(row.capacity),
      establishedOn:
        row.established_on instanceof Date
          ? row.established_on.toISOString().slice(0, 10)
          : (row.established_on ?? null),
      farmCategory: (row.farm_category as FarmCategory | null) ?? null,
    };
  }

  async updateProfile(
    organizationId: string,
    patch: UpdateFarmProfileInput,
    actor: FarmActor,
  ): Promise<FarmProfile> {
    await this.db.transaction(async (tx) => {
      await this.profiles.update(
        organizationId,
        {
          address: patch.address,
          capacity: patch.capacity,
          establishedOn: patch.establishedOn,
          farmCategory: patch.farmCategory,
        },
        tx,
      );
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_PROFILE_UPDATED,
          entityType: PoultryOpsAuditEntity.FARM_PROFILE,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('farm.profile.updated', { organizationId });
    return this.getProfile(organizationId);
  }

  async requestImageUploadUrl(
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
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a farm image`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    void organizationId;
    const storageKey = buildObjectKey(StoragePrefix.organizationFiles, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: IMAGE_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: IMAGE_UPLOAD_URL_TTL_SECONDS,
    };
  }

  async registerImage(
    organizationId: string,
    actor: FarmActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<FarmProfile> {
    if (!input.storageKey.startsWith(`${StoragePrefix.organizationFiles}/`)) {
      throw new BadRequestError('storage key does not belong to organization uploads', {
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

    const existing = await this.profiles.findByOrganizationId(organizationId);
    if (!existing) throw new InternalError('farm_details row missing for a FARM organization');
    const previousKey = existing.image_key;

    await this.db.transaction(async (tx) => {
      await this.profiles.update(
        organizationId,
        { imageKey: input.storageKey, imageProvider: this.storage.name },
        tx,
      );
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_PROFILE_UPDATED,
          entityType: PoultryOpsAuditEntity.FARM_PROFILE,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, imageUpdated: true, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
    });

    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error({ err, organizationId }, 'failed to delete replaced farm image — sweep');
      }
    }
    return this.getProfile(organizationId);
  }
}
