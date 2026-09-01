import type { Logger } from 'pino';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types.js';

/**
 * Fallback provider used when no real SMTP credentials are configured
 * (dev / test). Logs what would be sent and reports success so callers can
 * run end-to-end without a real mailbox.
 */
export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop';
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger.child({ component: 'email', provider: 'noop' });
  }

  isEnabled(): boolean {
    return false;
  }

  send(message: EmailMessage): Promise<EmailSendResult> {
    this.log.info(
      { to: message.to, subject: message.subject },
      'email suppressed (noop provider)',
    );
    return Promise.resolve({ success: true, provider: this.name });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
