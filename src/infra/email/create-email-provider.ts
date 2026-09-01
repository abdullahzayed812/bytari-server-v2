import type { Logger } from 'pino';
import type { AppConfig } from '../../config/index.js';
import { GmailEmailProvider } from './gmail-email-provider.js';
import { NoopEmailProvider } from './noop-email-provider.js';
import type { EmailProvider } from './types.js';

/**
 * Select the email provider from configuration:
 *  - Gmail SMTP when EMAIL_USER / EMAIL_PASS are present;
 *  - otherwise a logging no-op (dev / test).
 */
export function createEmailProvider(config: AppConfig, logger: Logger): EmailProvider {
  if (config.email) {
    logger.info({ user: config.email.user }, 'email provider: gmail (SMTP)');
    return new GmailEmailProvider(config.email, logger);
  }
  logger.warn('email provider: noop — EMAIL_USER/EMAIL_PASS not configured, email is disabled');
  return new NoopEmailProvider(logger);
}
