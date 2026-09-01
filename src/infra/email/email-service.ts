import type { Logger } from 'pino';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types.js';

/**
 * Module-facing email API: delegates delivery to the configured
 * {@link EmailProvider}. Business modules call this — not the provider or
 * the SMTP SDK directly.
 */
export class EmailService {
  private readonly log: Logger;

  constructor(
    private readonly provider: EmailProvider,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'email-service' });
  }

  get providerName(): string {
    return this.provider.name;
  }

  isEnabled(): boolean {
    return this.provider.isEnabled();
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const result = await this.provider.send(message);
    if (!result.success) {
      this.log.warn({ to: message.to, subject: message.subject }, 'email delivery failed');
    }
    return result;
  }
}
