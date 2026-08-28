export interface RefreshSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  userAgent: string | null;
  ip: string | null;
}

export interface CreateRefreshSessionData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
}

export interface RefreshSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
  replaced_by_session_id: string | null;
  user_agent: string | null;
  ip: string | null;
}

export function rowToRefreshSession(row: RefreshSessionRow): RefreshSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    replacedBySessionId: row.replaced_by_session_id,
    userAgent: row.user_agent,
    ip: row.ip,
  };
}
