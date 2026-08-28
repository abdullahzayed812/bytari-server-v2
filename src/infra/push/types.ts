/**
 * Push-notification infrastructure contracts (Firebase Cloud Messaging today,
 * swappable tomorrow). Business modules depend on {@link PushNotificationProvider}
 * / {@link PushNotificationService}, never on `firebase-admin`.
 */

export type DevicePlatform = 'ios' | 'android' | 'web';

/** Visible notification part of a message. */
export interface PushNotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
}

/** A message targeted at explicit device tokens. */
export interface PushMessage {
  tokens: string[];
  notification: PushNotificationPayload;
  /** String-only data map (FCM requirement). */
  data?: Record<string, string>;
  /** Optional platform tuning (badge, sound, priority…) — provider-interpreted. */
  options?: {
    priority?: 'normal' | 'high';
    sound?: string;
    badge?: number;
    collapseKey?: string;
    ttlSeconds?: number;
  };
}

export interface PushSendResult {
  successCount: number;
  failureCount: number;
  /** Tokens the provider reported as permanently invalid — callers should delete these. */
  invalidTokens: string[];
  /** Provider name that handled the send. */
  provider: string;
}

export interface PushNotificationProvider {
  readonly name: string;
  /** True when the provider has valid credentials and can actually deliver. */
  isEnabled(): boolean;
  /** Deliver to the given tokens. Never throws for per-token failures — see result. */
  send(message: PushMessage): Promise<PushSendResult>;
  /** Release provider resources (SDK apps, sockets). */
  shutdown(): Promise<void>;
}

// --- Device token registry -------------------------------------------------

export interface DeviceToken {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  createdAt: Date;
  lastSeenAt: Date;
  disabledAt: Date | null;
}

export interface RegisterDeviceTokenInput {
  userId: string;
  token: string;
  platform: DevicePlatform;
}

/**
 * Persistence port for device tokens. The Postgres adapter + migration land in
 * a later phase (needs the `users` table); an in-memory adapter backs tests now.
 */
export interface DeviceTokenRepository {
  /** Idempotent upsert keyed by `token` (re-registration refreshes `lastSeenAt`). */
  register(input: RegisterDeviceTokenInput): Promise<DeviceToken>;
  listActiveForUser(userId: string): Promise<DeviceToken[]>;
  removeByToken(token: string): Promise<void>;
  /** Mark tokens inactive after the provider reports them invalid. */
  disableTokens(tokens: string[]): Promise<void>;
}

export class PushProviderNotConfiguredError extends Error {
  constructor(message = 'Push provider is not configured') {
    super(message);
    this.name = 'PushProviderNotConfiguredError';
  }
}
