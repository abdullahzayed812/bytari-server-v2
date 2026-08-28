import type { Logger } from 'pino';
import type { AppConfig } from '../../config/index.js';
import { FirebasePushProvider } from './firebase-push-provider.js';
import { NoopPushProvider } from './noop-push-provider.js';
import type { PushNotificationProvider } from './types.js';

/**
 * Select the push provider from configuration:
 *  - Firebase when FCM credentials are present;
 *  - otherwise a logging no-op (dev / test).
 */
export function createPushProvider(config: AppConfig, logger: Logger): PushNotificationProvider {
  if (config.firebase) {
    logger.info('push provider: firebase (FCM)');
    return new FirebasePushProvider(config.firebase, logger);
  }
  logger.warn('push provider: noop — Firebase credentials not configured, push is disabled');
  return new NoopPushProvider(logger);
}
