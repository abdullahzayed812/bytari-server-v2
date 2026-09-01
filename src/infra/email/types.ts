/**
 * Outbound-email infrastructure contracts (Gmail SMTP via nodemailer today,
 * swappable tomorrow). Business modules depend on {@link EmailProvider} /
 * {@link EmailService}, never on `nodemailer` directly.
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  /** Plain-text body. At least one of `text` / `html` is required. */
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  success: boolean;
  /** Provider-assigned message id, when available. */
  messageId?: string;
  /** Provider name that handled (or refused) the send. */
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  /** True when the provider has valid credentials and can actually deliver. */
  isEnabled(): boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
  /** Release provider resources (SMTP connection pool). */
  shutdown(): Promise<void>;
}

export class EmailProviderNotConfiguredError extends Error {
  constructor(message = 'Email provider is not configured') {
    super(message);
    this.name = 'EmailProviderNotConfiguredError';
  }
}
