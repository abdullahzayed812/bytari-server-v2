import type { Knex } from 'knex';
import {
  type OneTimeCodePurpose,
  rowToEmailVerification,
  type EmailVerificationRecord,
  type EmailVerificationRow,
} from './email-verification.types.js';

const TABLE = 'email_verifications';

export interface CreateEmailVerificationData {
  userId: string;
  codeHash: string;
  expiresAt: Date;
}

/**
 * Data access for `email_verifications`. One instance is bound to ONE code
 * `purpose` (email verification vs password reset) and scopes every query to
 * it, so a password-reset code can never satisfy an email-verification check
 * (or vice versa) and issuing one never invalidates the other.
 */
export class EmailVerificationRepository {
  constructor(
    private readonly db: Knex,
    private readonly purpose: OneTimeCodePurpose = 'EMAIL_VERIFICATION',
  ) {}

  private table(trx?: Knex.Transaction): Knex.QueryBuilder<EmailVerificationRow> {
    return (trx ?? this.db)<EmailVerificationRow>(TABLE);
  }

  async create(
    data: CreateEmailVerificationData,
    trx?: Knex.Transaction,
  ): Promise<EmailVerificationRecord> {
    const [row] = await this.table(trx)
      .insert({
        user_id: data.userId,
        code_hash: data.codeHash,
        expires_at: data.expiresAt,
        purpose: this.purpose,
      })
      .returning('*');
    return rowToEmailVerification(row as EmailVerificationRow);
  }

  /** The current outstanding (unconsumed) code for a user, newest first. */
  async findCurrentForUser(
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<EmailVerificationRecord | null> {
    const row = await this.table(trx)
      .where({ user_id: userId, purpose: this.purpose })
      .whereNull('consumed_at')
      .orderBy('created_at', 'desc')
      .first();
    return row ? rowToEmailVerification(row) : null;
  }

  async incrementAttempts(id: string, trx?: Knex.Transaction): Promise<number> {
    const [row] = await this.table(trx)
      .where({ id })
      .increment('attempts', 1)
      .returning('attempts');
    return Number(row?.attempts ?? 0);
  }

  /**
   * Consume a code. Conditional on it still being outstanding, so two
   * concurrent requests presenting the same valid code cannot BOTH succeed —
   * exactly one sees `true` (one-time use).
   */
  async markConsumed(id: string, trx?: Knex.Transaction): Promise<boolean> {
    const updated = await this.table(trx)
      .where({ id })
      .whereNull('consumed_at')
      .update({ consumed_at: new Date() });
    return Number(updated) > 0;
  }

  /**
   * Invalidate every outstanding code for a user (a fresh one is about to be
   * issued — register / resend). Marks them consumed rather than deleting, so
   * the row a concurrent `verify-email` request is mid-checking still exists
   * (it will simply fail the "not consumed" / value check).
   */
  async consumeAllForUser(userId: string, trx?: Knex.Transaction): Promise<void> {
    await this.table(trx)
      .where({ user_id: userId, purpose: this.purpose })
      .whereNull('consumed_at')
      .update({
        consumed_at: new Date(),
      });
  }
}
