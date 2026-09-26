import { createHash, randomInt } from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, RateLimitError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { EmailService } from '../../infra/email/index.js';
import { secondsFromNow } from '../../shared/time/duration.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EmailVerificationRepository } from './email-verification.repository.js';

export interface EmailVerificationConfig {
  codeTtlSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
}

/** Subject + wording of the email that carries the code. */
export interface OneTimeCodeEmailCopy {
  subject: string;
  /** Sentence introducing the code, e.g. "Your Bytari verification code is:". */
  intro: string;
}

const DEFAULT_COPY: OneTimeCodeEmailCopy = {
  subject: 'Your Bytari verification code',
  intro: 'Your Bytari verification code is:',
};

export interface EmailVerificationActor {
  actorUserId: string | null;
  context?: AuditContext;
}

function generateCode(): string {
  // 6 digits, always zero-padded (`randomInt`'s range excludes the upper bound).
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Mandatory email-verification codes for self-registered accounts. Mirrors
 * `RefreshSessionService`'s shape exactly: only a SHA-256 hash of the secret
 * (here, a 6-digit code; there, an opaque token) is ever persisted — the raw
 * value exists only long enough to email it.
 *
 * Deliberately narrow: this service does NOT touch `users.status` — that is
 * `AuthService`'s job (the same pattern as `RefreshSessionService` never
 * touching `users` either). It only owns the `email_verifications` table.
 */
export class EmailVerificationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly repo: EmailVerificationRepository,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly config: EmailVerificationConfig,
    logger: Logger,
    private readonly copy: OneTimeCodeEmailCopy = DEFAULT_COPY,
  ) {
    this.log = logger.child({ component: 'email-verification' });
  }

  get codeTtlSeconds(): number {
    return this.config.codeTtlSeconds;
  }

  get resendCooldownSeconds(): number {
    return this.config.resendCooldownSeconds;
  }

  /**
   * DB-only: invalidate any code still outstanding for this user and issue a
   * fresh one. Runs inside the CALLER's transaction (e.g. `register()`'s) so
   * account creation and the first code are atomic. Returns the RAW code —
   * the caller emails it AFTER that transaction commits (storage/network I/O
   * never runs inside one, same rule `UserService.finalizeAvatar` follows).
   */
  async issueCode(userId: string, trx: Knex.Transaction): Promise<{ code: string; expiresAt: Date }> {
    await this.repo.consumeAllForUser(userId, trx);
    const code = generateCode();
    const expiresAt = secondsFromNow(this.config.codeTtlSeconds);
    await this.repo.create({ userId, codeHash: hashCode(code), expiresAt }, trx);
    return { code, expiresAt };
  }

  /** Pure email I/O — call only after the transaction that issued the code has committed. */
  async sendCodeEmail(to: string, firstName: string, code: string): Promise<void> {
    const minutes = Math.round(this.config.codeTtlSeconds / 60);
    await this.email.send({
      to,
      subject: this.copy.subject,
      text:
        `Hi ${firstName},\n\n` +
        `${this.copy.intro} ${code}\n\n` +
        `This code expires in ${minutes} minutes. If you did not request this, you can ignore this email.`,
      html:
        `<p>Hi ${firstName},</p>` +
        `<p>${this.copy.intro}</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p>` +
        `<p>This code expires in ${minutes} minutes. If you did not request this, you can ignore this email.</p>`,
    });
  }

  /**
   * Validate `code` against the current outstanding code for `userId`. Throws
   * a distinct, client-safe error for each failure mode (wrong code / expired
   * / locked out); the caller (`AuthService`) is responsible for treating an
   * UNKNOWN user the same as a wrong code (anti-enumeration) — this method
   * only ever runs once a real `userId` has already been resolved.
   */
  async verify(userId: string, rawCode: string): Promise<void> {
    // Deliberately NOT one `db.transaction(...)` wrapping the whole method:
    // Knex rolls back everything a transaction callback did the moment it
    // throws, and every failure path here needs to THROW to the caller. Wrap
    // that up together and `incrementAttempts` would be rolled back on every
    // single wrong guess — the attempt counter would never actually advance
    // and a lockout could never trigger. Each step below is its own
    // auto-committed statement instead; the tiny race between two truly
    // concurrent guesses both reading the same `attempts` value is harmless
    // (worst case one extra guess is allowed) and not worth a locking scheme
    // for a value this low-stakes.
    const current = await this.repo.findCurrentForUser(userId);
    if (!current) {
      throw new BadRequestError('Invalid or expired verification code', {
        code: ErrorCode.INVALID_VERIFICATION_CODE,
      });
    }
    if (current.attempts >= this.config.maxAttempts) {
      throw new RateLimitError('Too many attempts — request a new code', {
        code: ErrorCode.TOO_MANY_VERIFICATION_ATTEMPTS,
      });
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestError('This verification code has expired', {
        code: ErrorCode.VERIFICATION_CODE_EXPIRED,
      });
    }
    if (hashCode(rawCode) !== current.codeHash) {
      const attempts = await this.repo.incrementAttempts(current.id);
      if (attempts >= this.config.maxAttempts) {
        throw new RateLimitError('Too many attempts — request a new code', {
          code: ErrorCode.TOO_MANY_VERIFICATION_ATTEMPTS,
        });
      }
      throw new BadRequestError('Invalid or expired verification code', {
        code: ErrorCode.INVALID_VERIFICATION_CODE,
      });
    }
    // Conditional consume: a concurrent request that already used this code
    // wins, and this one fails exactly like a stale code would.
    const consumed = await this.repo.markConsumed(current.id);
    if (!consumed) {
      throw new BadRequestError('Invalid or expired verification code', {
        code: ErrorCode.INVALID_VERIFICATION_CODE,
      });
    }
  }

  /** Invalidate every outstanding code of this purpose for the user. */
  async invalidateAll(userId: string, trx?: Knex.Transaction): Promise<void> {
    await this.repo.consumeAllForUser(userId, trx);
  }

  /** Audit trail — called by `AuthService` after a successful send/verify (never on a failed attempt; matches `login()` not auditing wrong passwords). */
  async auditSent(userId: string, actor: EmailVerificationActor): Promise<void> {
    await this.audit.record({
      action: AuditAction.EMAIL_VERIFICATION_SENT,
      entityType: AuditEntityType.EMAIL_VERIFICATION,
      entityId: userId,
      actorUserId: actor.actorUserId,
      context: actor.context,
    });
  }

  async auditVerified(userId: string, actor: EmailVerificationActor): Promise<void> {
    await this.audit.record({
      action: AuditAction.EMAIL_VERIFIED,
      entityType: AuditEntityType.EMAIL_VERIFICATION,
      entityId: userId,
      actorUserId: actor.actorUserId,
      context: actor.context,
    });
  }

  /** Seconds until a resend is allowed again, given the current outstanding code (if any). */
  async resendAvailableInSeconds(userId: string): Promise<number> {
    const current = await this.repo.findCurrentForUser(userId);
    if (!current) return 0;
    const elapsed = (Date.now() - current.createdAt.getTime()) / 1000;
    return Math.max(0, Math.ceil(this.config.resendCooldownSeconds - elapsed));
  }
}
