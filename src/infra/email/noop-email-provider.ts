import type { Logger } from 'pino';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types.js';

/**
 * Fallback provider used when no real SMTP credentials are configured
 * (dev / test). Logs what would be sent and reports success so callers can
 * run end-to-end without a real mailbox.
 *
 * `sent` is a dev/test-only introspection hook — mirrors `InMemoryObjectStorage`
 * keeping its objects in memory "for tests and local development only". It
 * lets `test/helpers/factories.ts` read back a verification-code email a test
 * just triggered (the code is otherwise stored only as a one-way hash — see
 * `email-verification.repository.ts`) without ever adding a "peek the code"
 * backdoor to production code. Never read outside tests/dev tooling.
 */
export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop';
  private readonly log: Logger;
  readonly sent: EmailMessage[] = [];

  constructor(logger: Logger) {
    this.log = logger.child({ component: 'email', provider: 'noop' });
  }

  isEnabled(): boolean {
    return false;
  }

  send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    this.log.info(
      { to: message.to, subject: message.subject },
      'email suppressed (noop provider)',
    );
    return Promise.resolve({ success: true, provider: this.name });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  /** Test helper: the most recent message sent to `to`, or `undefined`. */
  lastMessageTo(to: string): EmailMessage | undefined {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const m = this.sent[i];
      const recipients = Array.isArray(m?.to) ? m.to : [m?.to];
      if (recipients.includes(to)) return m;
    }
    return undefined;
  }
}
