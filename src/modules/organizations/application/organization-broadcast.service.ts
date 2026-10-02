import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import {
  assertBroadcastImage,
  presignBroadcastImage,
  type BroadcastImagePresign,
} from '../../../shared/storage/broadcast-media.js';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';

export interface OrganizationBroadcastActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface SendBroadcastInput {
  title: string;
  body: string;
  imageStorageKey?: string | null;
  /** Optional http(s) link (validated by the route schema). */
  linkUrl?: string | null;
}

/**
 * Who receives a broadcast. `FOLLOWERS` (default) — everyone following the
 * organization ("إرسال رسالة للمتابعين"). `SYNDICATE_MEMBERS` — a syndicate's
 * ACTIVE registered members ("رسالة إلى الأعضاء"); the caller has already
 * checked the organization is a SYNDICATE.
 */
export type BroadcastAudience = 'FOLLOWERS' | 'SYNDICATE_MEMBERS';

export interface SendBroadcastOptions {
  audience?: BroadcastAudience;
  /**
   * Client-supplied idempotency key. The notification fan-out dedupes per
   * recipient on `organization.broadcast.sent:<broadcastId>`, so re-sending
   * the same request (double tap, retry) never notifies anyone twice.
   */
  idempotencyKey?: string;
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
  ): Promise<BroadcastImagePresign> {
    await this.assertActiveOrganization(organizationId);
    return presignBroadcastImage(this.storage, StoragePrefix.organizationBroadcastImages, input);
  }

  async send(
    organizationId: string,
    input: SendBroadcastInput,
    actor: OrganizationBroadcastActor,
    options: SendBroadcastOptions = {},
  ): Promise<{ broadcastId: string }> {
    await this.assertActiveOrganization(organizationId);

    // The notification rows keep the storage KEY, resolved to a fresh URL on
    // every read — a signed URL stored here would expire an hour later.
    let imageKey: string | null = null;
    if (input.imageStorageKey) {
      await assertBroadcastImage(
        this.storage,
        StoragePrefix.organizationBroadcastImages,
        input.imageStorageKey,
      );
      imageKey = input.imageStorageKey;
    }

    const audience = options.audience ?? 'FOLLOWERS';
    const broadcastId = options.idempotencyKey
      ? `${organizationId}:${options.idempotencyKey}`
      : randomUUID();
    await this.audit.record({
      action: AuditAction.ORGANIZATION_BROADCAST_SENT,
      entityType: AuditEntityType.ORGANIZATION,
      entityId: organizationId,
      actorUserId: actor.actorUserId,
      metadata: {
        organizationId,
        broadcastId,
        audience,
        title: input.title,
        hasImage: Boolean(imageKey),
        hasLink: Boolean(input.linkUrl),
      },
      context: actor.context,
    });

    this.events.publish('organization.broadcast.sent', {
      organizationId,
      broadcastId,
      title: input.title,
      body: input.body,
      imageKey,
      linkUrl: input.linkUrl ?? null,
      audience,
      actorUserId: actor.actorUserId,
    });

    return { broadcastId };
  }

  private async assertActiveOrganization(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Organization not found');
  }
}
