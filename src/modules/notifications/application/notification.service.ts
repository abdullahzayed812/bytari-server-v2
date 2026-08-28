import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { PushNotificationService } from '../../../infra/push/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import {
  MAX_BROADCAST_RECIPIENTS,
  type AdminTargetKind,
  type NotificationType,
} from '../domain/notification.constants.js';
import {
  toDeviceTokenDTO,
  toNotificationDTO,
  type DeviceTokenDTO,
  type ListNotificationsFilter,
  type NotificationDTO,
  type NotificationSpec,
} from '../domain/notification.types.js';
import type {
  DeviceTokenRepository,
  RegisterDeviceInput,
} from '../infrastructure/device-token.repository.js';
import type { NotificationRepository } from '../infrastructure/notification.repository.js';
import type {
  NotificationPreferences,
  PreferenceRepository,
} from '../infrastructure/preference.repository.js';

export interface NotificationActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface AdminNotificationInput {
  target: { kind: 'USER'; userId: string } | { kind: 'ROLE'; roleKey: string } | { kind: 'ALL' };
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const PUSH_FANOUT_BATCH = 200;

function tokenSuffix(token: string): string {
  return token.length > 6 ? `…${token.slice(-6)}` : '…';
}

/**
 * Owns in-app notification persistence + the three delivery channels
 * (DB row = source of truth; FCM push; realtime `notification.created`).
 * A push or realtime failure NEVER removes / rolls back a notification row.
 *
 * Firebase is reached only through the injected {@link PushNotificationService}
 * — this class imports no `firebase-admin`.
 */
export class NotificationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly notifications: NotificationRepository,
    private readonly devices: DeviceTokenRepository,
    private readonly preferences: PreferenceRepository,
    private readonly push: PushNotificationService,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'notification-service' });
  }

  // --- event-driven delivery (called by the handler) --------------------

  async deliverSpecs(specs: NotificationSpec[]): Promise<void> {
    for (const spec of specs) {
      try {
        await this.deliverOne(spec);
      } catch (err) {
        this.log.error(
          { err, type: spec.type, recipient: spec.recipientUserId },
          'notification delivery failed for one recipient',
        );
      }
    }
  }

  private async deliverOne(spec: NotificationSpec): Promise<void> {
    const created = await this.db.transaction((tx) =>
      this.notifications.create(
        {
          recipientUserId: spec.recipientUserId,
          type: spec.type,
          title: spec.title,
          body: spec.body,
          data: spec.data,
          actorUserId: spec.actorUserId ?? null,
          entityType: spec.entityType ?? null,
          entityId: spec.entityId ?? null,
          sourceEventKey: spec.sourceEventKey ?? null,
        },
        tx,
      ),
    );
    if (!created) return; // duplicate source event — already delivered

    // realtime — best effort, after commit
    this.events.publish('notification.created', {
      notificationId: created.id,
      recipientUserId: created.recipientUserId,
      type: created.type,
    });

    // FCM — best effort, gated by the user's preference
    if (spec.push) {
      try {
        if (await this.preferences.pushEnabled(spec.recipientUserId)) {
          await this.push.sendToUser(
            spec.recipientUserId,
            { title: spec.title, body: spec.body },
            spec.data,
          );
        }
      } catch (err) {
        this.log.warn({ err, notificationId: created.id }, 'push delivery failed — in-app kept');
      }
    }
  }

  // --- user reads ----------------------------------------------------

  list(
    userId: string,
    filter: ListNotificationsFilter,
  ): Promise<{ items: NotificationDTO[]; total: number }> {
    return this.notifications.listForUser(userId, filter).then(({ items, total }) => ({
      items: items.map(toNotificationDTO),
      total,
    }));
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.unreadCount(userId);
  }

  async get(userId: string, id: string): Promise<NotificationDTO> {
    const n = await this.notifications.findByIdForUser(id, userId);
    if (!n) throw new NotFoundError('Notification not found');
    return toNotificationDTO(n);
  }

  async markRead(userId: string, id: string): Promise<NotificationDTO> {
    const existing = await this.notifications.findByIdForUser(id, userId);
    if (!existing) throw new NotFoundError('Notification not found');
    if (existing.readAt) return toNotificationDTO(existing); // idempotent

    const updated = await this.db.transaction((tx) => this.notifications.markRead(id, userId, tx));
    if (updated)
      this.events.publish('notification.read', { notificationId: id, recipientUserId: userId });
    return toNotificationDTO(updated ?? existing);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const updated = await this.db.transaction((tx) => this.notifications.markAllRead(userId, tx));
    if (updated > 0)
      this.events.publish('notification.read', { recipientUserId: userId, all: true });
    return { updated };
  }

  // --- preferences -------------------------------------------------

  getPreferences(userId: string): Promise<NotificationPreferences> {
    return this.preferences.get(userId);
  }

  async updatePreferences(
    actor: NotificationActor,
    patch: { pushEnabled: boolean },
  ): Promise<NotificationPreferences> {
    const prefs = await this.db.transaction(async (tx) => {
      const next = await this.preferences.upsert(actor.actorUserId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.NOTIFICATION_PREFERENCE_UPDATED,
          entityType: AuditEntityType.NOTIFICATION,
          entityId: actor.actorUserId,
          actorUserId: actor.actorUserId,
          metadata: { pushEnabled: patch.pushEnabled },
          context: actor.context,
        },
        tx,
      );
      return next;
    });
    this.events.publish('notification.preference.updated', { userId: actor.actorUserId });
    return prefs;
  }

  // --- device tokens --------------------------------------------

  async registerDevice(
    actor: NotificationActor,
    input: Omit<RegisterDeviceInput, 'userId'>,
  ): Promise<DeviceTokenDTO> {
    const row = await this.db.transaction(async (tx) => {
      const device = await this.devices.upsert({ ...input, userId: actor.actorUserId }, tx);
      await this.audit.record(
        {
          action: AuditAction.DEVICE_TOKEN_REGISTERED,
          entityType: AuditEntityType.DEVICE_PUSH_TOKEN,
          entityId: device.id,
          actorUserId: actor.actorUserId,
          // token itself is NEVER stored in audit metadata
          metadata: { platform: input.platform, tokenSuffix: tokenSuffix(input.token) },
          context: actor.context,
        },
        tx,
      );
      return device;
    });
    this.events.publish('notification.device.registered', {
      deviceId: row.id,
      userId: actor.actorUserId,
    });
    return toDeviceTokenDTO(row);
  }

  async listDevices(userId: string): Promise<DeviceTokenDTO[]> {
    const rows = await this.devices.listForUser(userId, { includeRevoked: false });
    return rows.map(toDeviceTokenDTO);
  }

  async removeDevice(actor: NotificationActor, deviceId: string): Promise<void> {
    const device = await this.devices.findByIdForUser(deviceId, actor.actorUserId);
    if (!device) throw new NotFoundError('Device not found');

    await this.db.transaction(async (tx) => {
      await this.devices.deleteByIdForUser(deviceId, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.DEVICE_TOKEN_REVOKED,
          entityType: AuditEntityType.DEVICE_PUSH_TOKEN,
          entityId: deviceId,
          actorUserId: actor.actorUserId,
          metadata: { platform: device.platform, tokenSuffix: tokenSuffix(device.token) },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('notification.device.revoked', { deviceId, userId: actor.actorUserId });
  }

  // --- admin broadcast -----------------------------------------

  async adminBroadcast(
    actor: NotificationActor,
    input: AdminNotificationInput,
  ): Promise<{ recipientCount: number }> {
    const recipientIds = await this.resolveBroadcastRecipients(input.target);

    if (recipientIds.length > MAX_BROADCAST_RECIPIENTS) {
      throw new BadRequestError(
        `broadcast targets ${recipientIds.length} users — the limit is ${MAX_BROADCAST_RECIPIENTS}`,
        { code: ErrorCode.BROADCAST_TOO_LARGE },
      );
    }
    if (recipientIds.length === 0) return { recipientCount: 0 };

    await this.db.transaction(async (tx) => {
      const rows = recipientIds.map((uid) => ({
        recipient_user_id: uid,
        type: input.type,
        title: input.title,
        body: input.body,
        data: JSON.stringify({ type: input.type, ...(input.data ?? {}) }),
        actor_user_id: actor.actorUserId,
      }));
      // batched insert — bounded by MAX_BROADCAST_RECIPIENTS
      for (let i = 0; i < rows.length; i += 500) {
        await tx('notifications').insert(rows.slice(i, i + 500));
      }
      await this.audit.record(
        {
          action: AuditAction.ADMIN_NOTIFICATION_SENT,
          entityType: AuditEntityType.NOTIFICATION,
          entityId: null,
          actorUserId: actor.actorUserId,
          // no body / no tokens in audit metadata
          metadata: {
            targetKind: input.target.kind,
            type: input.type,
            recipientCount: recipientIds.length,
          },
          context: actor.context,
        },
        tx,
      );
    });

    // FCM fan-out detached from the HTTP response (in-app rows are already
    // persisted — the source of truth). No durable queue: a crash mid-fan-out
    // leaves push partial; in-app is unaffected. See ARCHITECTURE §22.
    void this.fanOutPush(
      recipientIds,
      { title: input.title, body: input.body },
      {
        type: input.type,
        ...(input.data ?? {}),
      },
    );

    return { recipientCount: recipientIds.length };
  }

  private async resolveBroadcastRecipients(
    target: AdminNotificationInput['target'],
  ): Promise<string[]> {
    if (target.kind === 'USER') {
      const user = await this.users.getByIdOrNull(target.userId);
      if (!user) throw new NotFoundError('Target user not found');
      return [user.id];
    }
    if (target.kind === 'ROLE') {
      const rows: Array<{ id: string }> = await this.db('user_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .join('users as u', 'u.id', 'ur.user_id')
        .where('r.key', target.roleKey)
        .andWhere('u.status', 'ACTIVE')
        .distinct('u.id as id');
      return rows.map((r) => r.id);
    }
    // ALL
    const rows: Array<{ id: string }> = await this.db('users')
      .where({ status: 'ACTIVE' })
      .select('id');
    return rows.map((r) => r.id);
  }

  private async fanOutPush(
    userIds: string[],
    notification: { title: string; body: string },
    data: Record<string, string>,
  ): Promise<void> {
    for (let i = 0; i < userIds.length; i += PUSH_FANOUT_BATCH) {
      const batch = userIds.slice(i, i + PUSH_FANOUT_BATCH);
      await Promise.all(
        batch.map(async (uid) => {
          try {
            if (await this.preferences.pushEnabled(uid)) {
              await this.push.sendToUser(uid, notification, data);
            }
          } catch (err) {
            this.log.warn({ err, uid }, 'broadcast push failed for one user');
          }
        }),
      );
    }
  }
}

export type { AdminTargetKind };
