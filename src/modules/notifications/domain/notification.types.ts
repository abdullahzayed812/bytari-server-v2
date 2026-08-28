import type { DevicePlatform, NotificationType } from './notification.constants.js';

// --- aggregates ------------------------------------------------

export interface Notification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  sourceEventKey: string | null;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceToken {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceId: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- DTOs ----------------------------------------------------

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

/** Device view — the raw FCM token is NEVER returned, only a short suffix. */
export interface DeviceTokenDTO {
  id: string;
  platform: DevicePlatform;
  deviceId: string | null;
  appVersion: string | null;
  tokenSuffix: string;
  lastSeenAt: string;
  revoked: boolean;
  createdAt: string;
}

// --- rows --------------------------------------------------

export interface NotificationRow {
  id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actor_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  source_event_key: string | null;
  read_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DeviceTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  device_id: string | null;
  app_version: string | null;
  last_seen_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    data: row.data ?? {},
    actorUserId: row.actor_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    sourceEventKey: row.source_event_key,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToDeviceToken(row: DeviceTokenRow): DeviceToken {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform as DevicePlatform,
    deviceId: row.device_id,
    appVersion: row.app_version,
    lastSeenAt: row.last_seen_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    actorUserId: n.actorUserId,
    entityType: n.entityType,
    entityId: n.entityId,
    read: n.readAt !== null,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

export function toDeviceTokenDTO(d: DeviceToken): DeviceTokenDTO {
  return {
    id: d.id,
    platform: d.platform,
    deviceId: d.deviceId,
    appVersion: d.appVersion,
    tokenSuffix: d.token.length > 6 ? `…${d.token.slice(-6)}` : '…',
    lastSeenAt: d.lastSeenAt,
    revoked: d.revokedAt !== null,
    createdAt: d.createdAt,
  };
}

// --- inputs ------------------------------------------------

export interface CreateNotificationInput {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceEventKey?: string | null;
}

export interface ListNotificationsFilter {
  page: number;
  pageSize: number;
  read?: boolean;
  type?: NotificationType;
}

/** A resolved notification target produced by {@link NotificationPolicy}. */
export interface NotificationSpec {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  actorUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Deterministic per-recipient key from the source event, for idempotency. */
  sourceEventKey?: string | null;
  /** Whether to also attempt an FCM push (subject to the user's preference). */
  push: boolean;
}
