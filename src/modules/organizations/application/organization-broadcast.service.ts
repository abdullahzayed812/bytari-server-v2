import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;

export interface OrganizationBroadcastActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface SendBroadcastInput {
  title: string;
  body: string;
  imageStorageKey?: string | null;
}

/**
 * "إرسال رسالة للمتابعين" — an organization messages everyone following it. Pure
 * fan-out, mirroring `NotificationPolicy.syndicateFollowersToNotify`
 * (`organizationBroadcastToFollowers`) — deliberately NOT a persisted content
 * entity (no screenshot shows a "past broadcasts" feed), so there is nothing to
 * list, edit, or moderate here; `send` only validates, audits, and publishes the
 * event the notification policy fans out from `organization_follows`. Generic
 * across any organization type with followers (not Veterinary-Office-specific)
 * so a future Clinic Dashboard reuses this instead of a second broadcast system.
 */
export class OrganizationBroadcastService {
  private readonly log: Logger;

  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-broadcast-service' });
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
    await this.assertActiveOrganization(organizationId);
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(input.mimeType)) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const storageKey = buildObjectKey(StoragePrefix.organizationBroadcastImages, input.filename);
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

  async send(
    organizationId: string,
    input: SendBroadcastInput,
    actor: OrganizationBroadcastActor,
  ): Promise<{ broadcastId: string }> {
    await this.assertActiveOrganization(organizationId);

    let imageUrl: string | null = null;
    if (input.imageStorageKey) {
      if (!input.imageStorageKey.startsWith(`${StoragePrefix.organizationBroadcastImages}/`)) {
        throw new BadRequestError('storage key does not belong to broadcast uploads', {
          code: ErrorCode.STORAGE_KEY_MISMATCH,
        });
      }
      const head = await this.storage.head(input.imageStorageKey);
      if (!head) {
        throw new BadRequestError('no uploaded object exists at that storage key', {
          code: ErrorCode.STORAGE_OBJECT_MISSING,
        });
      }
      imageUrl = await resolveStorageUrlOrNull(this.storage, input.imageStorageKey, IMAGE_URL_TTL_SECONDS);
    }

    const broadcastId = randomUUID();
    await this.audit.record({
      action: AuditAction.ORGANIZATION_BROADCAST_SENT,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: organizationId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId, broadcastId, title: input.title },
      context: actor.context,
    });

    this.events.publish('organization.broadcast.sent', {
      organizationId,
      broadcastId,
      title: input.title,
      body: input.body,
      imageUrl,
      actorUserId: actor.actorUserId,
    });

    return { broadcastId };
  }

  private async assertActiveOrganization(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Organization not found');
  }
}
