import type { Logger } from 'pino';
import type { PushMessage, PushNotificationProvider, PushSendResult } from './types.js';

/**
 * Fallback provider used when no real push backend is configured (dev / test).
 * Logs what would be sent and reports success so callers can run end-to-end.
 */
export class NoopPushProvider implements PushNotificationProvider {
  readonly name = 'noop';
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger.child({ component: 'push', provider: 'noop' });
  }

  isEnabled(): boolean {
    return false;
  }

  send(message: PushMessage): Promise<PushSendResult> {
    this.log.info(
      { tokens: message.tokens.length, title: message.notification.title },
      'push notification suppressed (noop provider)',
    );
    return Promise.resolve({
      successCount: message.tokens.length,
      failureCount: 0,
      invalidTokens: [],
      provider: this.name,
    });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
