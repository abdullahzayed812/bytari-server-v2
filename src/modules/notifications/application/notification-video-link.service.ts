import type { Knex } from 'knex';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  NOTIFICATION_VIDEO_LINK_KEYS,
  NOTIFICATION_VIDEO_MESSAGE_AR,
  type NotificationVideoLinkKey,
} from '../domain/notification.constants.js';
import type { NotificationVideoLinkRepository } from '../infrastructure/notification-video-link.repository.js';

export interface NotificationVideoLinkDTO {
  key: NotificationVideoLinkKey;
  /** `null` = no video for this notification. */
  url: string | null;
  updatedAt: string | null;
}

export interface VideoLinkActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Admin-managed video links for acceptance notifications. The notification
 * rows only carry `data.videoLinkKey`; `attachVideoUrl` resolves it to the
 * CURRENT URL on read, so an edit / removal applies to every notification.
 */
export class NotificationVideoLinkService {
  constructor(
    private readonly db: Knex,
    private readonly links: NotificationVideoLinkRepository,
    private readonly audit: AuditService,
  ) {}

  /** Every key in a fixed order, with its link or `null`. */
  async list(): Promise<NotificationVideoLinkDTO[]> {
    const rows = await this.links.listAll();
    const byKey = new Map(rows.map((r) => [r.link_key, r]));
    return NOTIFICATION_VIDEO_LINK_KEYS.map((key) => {
      const row = byKey.get(key);
      return {
        key,
        url: row?.url ?? null,
        updatedAt: row ? new Date(row.updated_at).toISOString() : null,
      };
    });
  }

  async set(
    key: NotificationVideoLinkKey,
    url: string,
    actor: VideoLinkActor,
  ): Promise<NotificationVideoLinkDTO> {
    const row = await this.db.transaction(async (tx) => {
      const before = await this.links.find(key, tx);
      const saved = await this.links.upsert(key, url, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.NOTIFICATION_VIDEO_LINK_UPDATED,
          entityType: AuditEntityType.NOTIFICATION,
          entityId: null,
          actorUserId: actor.actorUserId,
          metadata: { key, url, previousUrl: before?.url ?? null },
          context: actor.context,
        },
        tx,
      );
      return saved;
    });
    return { key, url: row.url, updatedAt: new Date(row.updated_at).toISOString() };
  }

  async remove(key: NotificationVideoLinkKey, actor: VideoLinkActor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const before = await this.links.find(key, tx);
      if (!before) return; // idempotent
      await this.links.delete(key, tx);
      await this.audit.record(
        {
          action: AuditAction.NOTIFICATION_VIDEO_LINK_REMOVED,
          entityType: AuditEntityType.NOTIFICATION,
          entityId: null,
          actorUserId: actor.actorUserId,
          metadata: { key, previousUrl: before.url },
          context: actor.context,
        },
        tx,
      );
    });
  }

  /**
   * `data.videoLinkKey` → `data.videoUrl` (the current link) + `data.videoMessage`
   * (the accompanying sentence), or unchanged when none is set. One
   * primary-key lookup, only for stamped notifications.
   */
  async attachVideoUrl(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = await this.currentUrl(data);
    return url ? { ...data, videoUrl: url, videoMessage: NOTIFICATION_VIDEO_MESSAGE_AR } : data;
  }

  /**
   * Push body for a stamped notification: the body plus the video sentence
   * when a link is set right now (the push itself never carries the URL — a
   * tap opens the notification, whose details show the "watch" button).
   */
  async pushBody(data: Record<string, unknown>, body: string): Promise<string> {
    const url = await this.currentUrl(data);
    return url ? `${body}\n${NOTIFICATION_VIDEO_MESSAGE_AR}` : body;
  }

  private async currentUrl(data: Record<string, unknown>): Promise<string | null> {
    const key = data.videoLinkKey;
    if (!(NOTIFICATION_VIDEO_LINK_KEYS as readonly unknown[]).includes(key)) return null;
    const row = await this.links.find(key as NotificationVideoLinkKey);
    return row?.url ?? null;
  }
}
