import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { EmailConfig } from '../../config/index.js';
import { EmailProviderNotConfiguredError, type EmailMessage, type EmailProvider, type EmailSendResult } from './types.js';

/**
 * Gmail SMTP implementation of {@link EmailProvider}, via nodemailer.
 *
 * `EMAIL_PASS` must be a Gmail **App Password** (Google Account → Security →
 * 2-Step Verification → App passwords) — never the account's login password;
 * Gmail rejects normal-password SMTP auth for accounts with 2FA, and even
 * without 2FA using the real password here would be needlessly risky.
 */
export class GmailEmailProvider implements EmailProvider {
  readonly name = 'gmail';
  private readonly log: Logger;
  private readonly transporter: Transporter;

  constructor(
    private readonly config: EmailConfig,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'email', provider: 'gmail' });
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.user, pass: config.pass },
    });
  }

  isEnabled(): boolean {
    return true;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!message.text && !message.html) {
      throw new EmailProviderNotConfiguredError('EmailMessage needs `text` and/or `html`');
    }

    try {
      // nodemailer types `SentMessageInfo` as `any` — narrow to the one field we use.
      const info = (await this.transporter.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
        attachments: message.attachments,
      })) as { messageId?: string };
      return { success: true, messageId: info.messageId, provider: this.name };
    } catch (err) {
      this.log.error({ err, to: message.to }, 'email send failed');
      return { success: false, provider: this.name };
    }
  }

  shutdown(): Promise<void> {
    this.transporter.close();
    return Promise.resolve();
  }
}
