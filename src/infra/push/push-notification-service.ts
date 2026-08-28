import type { Logger } from 'pino';
import type {
  DeviceTokenRepository,
  PushMessage,
  PushNotificationPayload,
  PushNotificationProvider,
  PushSendResult,
  RegisterDeviceTokenInput,
} from './types.js';

/**
 * Module-facing push API: resolves a user's devices, delegates delivery to the
 * configured {@link PushNotificationProvider}, and prunes tokens the provider
 * reports as invalid. Business modules call this — not the provider or the SDK.
 */
export class PushNotificationService {
  private readonly log: Logger;

  constructor(
    private readonly provider: PushNotificationProvider,
    private readonly deviceTokens: DeviceTokenRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'push-service' });
  }

  get providerName(): string {
    return this.provider.name;
  }

  isEnabled(): boolean {
    return this.provider.isEnabled();
  }

  registerDevice(input: RegisterDeviceTokenInput): Promise<unknown> {
    return this.deviceTokens.register(input);
  }

  unregisterDevice(token: string): Promise<void> {
    return this.deviceTokens.removeByToken(token);
  }

  /** Send to every active device of a single user. */
  async sendToUser(
    userId: string,
    notification: PushNotificationPayload,
    data?: Record<string, string>,
    options?: PushMessage['options'],
  ): Promise<PushSendResult> {
    const devices = await this.deviceTokens.listActiveForUser(userId);
    const tokens = devices.map((d) => d.token);
    if (tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [], provider: this.provider.name };
    }
    return this.dispatch({ tokens, notification, data, options });
  }

  /** Send to explicit tokens (e.g. a just-registered device). */
  sendToTokens(message: PushMessage): Promise<PushSendResult> {
    return this.dispatch(message);
  }

  private async dispatch(message: PushMessage): Promise<PushSendResult> {
    const result = await this.provider.send(message);
    if (result.invalidTokens.length > 0) {
      await this.deviceTokens.disableTokens(result.invalidTokens);
      this.log.info({ count: result.invalidTokens.length }, 'disabled invalid device tokens');
    }
    return result;
  }
}
