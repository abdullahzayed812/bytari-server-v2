import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import type { EmailConfig } from '../../config/index.js';
import {
  EmailProviderNotConfiguredError,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
} from './types.js';

/**
 * SMTP implementation of {@link EmailProvider}, via nodemailer.
 *
 * With `EMAIL_HOST` set it talks to that server (e.g. Hostinger:
 * `smtp.hostinger.com`, port 465, SSL) using the mailbox's own password.
 * Without it, falls back to Gmail — there `EMAIL_PASS` must be a Gmail **App
 * Password** (Google Account → Security → 2-Step Verification → App
 * passwords), never the account's login password.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name: string;
  private readonly log: Logger;
  private readonly transporter: Transporter;

  constructor(
    private readonly config: EmailConfig,
    logger: Logger,
  ) {
    this.name = config.host ?? 'gmail';
    this.log = logger.child({ component: 'email', provider: this.name });
    const auth = { user: config.user, pass: config.pass };
    this.transporter = config.host
      ? nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth,
        })
      : nodemailer.createTransport({ service: 'gmail', auth });
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
