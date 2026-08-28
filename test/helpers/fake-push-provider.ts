import type {
  PushMessage,
  PushNotificationProvider,
  PushSendResult,
} from '../../src/infra/push/index.js';

export interface RecordedPush {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Inspectable {@link PushNotificationProvider} for tests. No real Firebase.
 *
 *  - records every `send()` for assertions,
 *  - `invalidTokens` → reported back so `PushNotificationService` revokes them,
 *  - `failNextWith` → the next `send()` rejects (transient failure),
 *  - `enabled` → toggles `isEnabled()` without changing behaviour.
 */
export class FakePushProvider implements PushNotificationProvider {
  readonly name = 'fake';
  readonly sent: RecordedPush[] = [];
  invalidTokens = new Set<string>();
  private failNext: Error | null = null;
  enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  failNextWith(err: Error): void {
    this.failNext = err;
  }

  markInvalid(...tokens: string[]): void {
    for (const t of tokens) this.invalidTokens.add(t);
  }

  reset(): void {
    this.sent.length = 0;
    this.invalidTokens.clear();
    this.failNext = null;
    this.enabled = true;
  }

  send(message: PushMessage): Promise<PushSendResult> {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      return Promise.reject(err);
    }
    this.sent.push({
      tokens: [...message.tokens],
      title: message.notification.title,
      body: message.notification.body,
      data: message.data,
    });
    const invalid = message.tokens.filter((t) => this.invalidTokens.has(t));
    return Promise.resolve({
      successCount: message.tokens.length - invalid.length,
      failureCount: invalid.length,
      invalidTokens: invalid,
      provider: this.name,
    });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
