/** What a one-time code in `email_verifications` is for. */
export const ONE_TIME_CODE_PURPOSES = ['EMAIL_VERIFICATION', 'PASSWORD_RESET'] as const;
export type OneTimeCodePurpose = (typeof ONE_TIME_CODE_PURPOSES)[number];

export interface EmailVerificationRow {
  id: string;
  user_id: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
  created_at: Date;
  purpose: OneTimeCodePurpose;
}

export interface EmailVerificationRecord {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

export function rowToEmailVerification(row: EmailVerificationRow): EmailVerificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  };
}
