import type { Logger } from 'pino';
import type { App } from 'firebase-admin/app';
import type { Messaging, MulticastMessage } from 'firebase-admin/messaging';
import type { FirebaseConfig } from '../../config/index.js';
import {
  PushProviderNotConfiguredError,
  type PushMessage,
  type PushNotificationProvider,
  type PushSendResult,
} from './types.js';

/** FCM multicast hard limit per request. */
const MAX_TOKENS_PER_BATCH = 500;

const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Firebase Cloud Messaging implementation of {@link PushNotificationProvider}.
 *
 * `firebase-admin` is imported dynamically and the SDK app is initialised lazily
 * on first send, so the dependency is never loaded when push is unconfigured.
 * Credentials come exclusively from validated env config — nothing hardcoded.
 */
export class FirebasePushProvider implements PushNotificationProvider {
  readonly name = 'firebase';
  private readonly log: Logger;
  private app: App | null = null;
  private messaging: Messaging | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly config: FirebaseConfig,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'push', provider: 'firebase' });
  }

  isEnabled(): boolean {
    return true;
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    const tokens = message.tokens.filter((t) => t.length > 0);
    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [], provider: this.name };
    }

    const messaging = await this.ensureMessaging();
    const result: PushSendResult = {
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      provider: this.name,
    };

    for (const batch of chunk(tokens, MAX_TOKENS_PER_BATCH)) {
      const payload: MulticastMessage = {
        tokens: batch,
        notification: {
          title: message.notification.title,
          body: message.notification.body,
          ...(message.notification.imageUrl ? { imageUrl: message.notification.imageUrl } : {}),
        },
        ...(message.data ? { data: message.data } : {}),
        android: {
          priority: message.options?.priority === 'normal' ? 'normal' : 'high',
          ...(message.options?.ttlSeconds !== undefined
            ? { ttl: message.options.ttlSeconds * 1000 }
            : {}),
          ...(message.options?.collapseKey ? { collapseKey: message.options.collapseKey } : {}),
        },
        apns: {
          payload: {
            aps: {
              ...(message.options?.sound ? { sound: message.options.sound } : {}),
              ...(message.options?.badge !== undefined ? { badge: message.options.badge } : {}),
            },
          },
        },
      };

      const response = await messaging.sendEachForMulticast(payload);
      result.successCount += response.successCount;
      result.failureCount += response.failureCount;

      response.responses.forEach((r, idx) => {
        if (r.success || !r.error) return;
        const token = batch[idx];
        if (token && INVALID_TOKEN_ERROR_CODES.has(r.error.code)) {
          result.invalidTokens.push(token);
        } else {
          this.log.warn({ code: r.error?.code }, 'push send failure');
        }
      });
    }

    return result;
  }

  async shutdown(): Promise<void> {
    if (!this.app) return;
    const { deleteApp } = await import('firebase-admin/app');
    await deleteApp(this.app);
    this.app = null;
    this.messaging = null;
    this.initPromise = null;
  }

  private async ensureMessaging(): Promise<Messaging> {
    this.initPromise ??= this.initialize();
    await this.initPromise;
    if (!this.messaging) throw new PushProviderNotConfiguredError('Firebase messaging unavailable');
    return this.messaging;
  }

  private async initialize(): Promise<void> {
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');

    const serviceAccount = this.resolveServiceAccount();
    this.app = initializeApp({ credential: cert(serviceAccount) }, `bytari-push-${Date.now()}`);
    this.messaging = getMessaging(this.app);
    this.log.info({ projectId: serviceAccount.projectId }, 'firebase push provider initialised');
  }

  private resolveServiceAccount(): { projectId: string; clientEmail: string; privateKey: string } {
    if (this.config.serviceAccountJson) {
      const raw = this.config.serviceAccountJson.trim();
      const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const parsed = JSON.parse(json) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        throw new PushProviderNotConfiguredError('FIREBASE_SERVICE_ACCOUNT_JSON is missing fields');
      }
      return {
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      };
    }

    if (!this.config.projectId || !this.config.clientEmail || !this.config.privateKey) {
      throw new PushProviderNotConfiguredError('Firebase credentials are incomplete');
    }
    return {
      projectId: this.config.projectId,
      clientEmail: this.config.clientEmail,
      privateKey: this.config.privateKey,
    };
  }
}
