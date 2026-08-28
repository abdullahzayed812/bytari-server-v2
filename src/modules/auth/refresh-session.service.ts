import { createHash, randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import { secondsFromNow } from '../../shared/time/duration.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RefreshSessionRepository } from './refresh-session.repository.js';
import {
  rowToRefreshSession,
  type RefreshSession,
  type RefreshSessionRow,
} from './refresh-session.types.js';
import type { TokenService } from './token.service.js';

function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
  audit?: AuditContext;
}

export interface IssuedRefresh {
  rawToken: string;
  session: RefreshSession;
}

export interface RotatedRefresh {
  userId: string;
  rawToken: string;
  session: RefreshSession;
}

/**
 * Owns the lifecycle of opaque refresh tokens / sessions:
 * issue, rotate (with replay detection), and revoke.
 * Only SHA-256 hashes of the raw tokens are ever stored.
 */
export class RefreshSessionService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly repo: RefreshSessionRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'refresh-session' });
  }

  async issue(userId: string, ctx: SessionContext, trx?: Knex.Transaction): Promise<IssuedRefresh> {
    const rawToken = generateRawToken();
    const session = await this.repo.create(
      {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: secondsFromNow(this.tokens.refreshTokenTtlSeconds()),
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      },
      trx,
    );
    return { rawToken, session };
  }

  /**
   * Validate + rotate a refresh token. Presenting an already-revoked token is
   * treated as replay: every session for that user is revoked and an audit entry
   * written — and, crucially, that revocation is COMMITTED before the error is
   * raised (it must not be rolled back by the thrown rejection).
   */
  async rotate(rawToken: string, ctx: SessionContext): Promise<RotatedRefresh> {
    const tokenHash = hashToken(rawToken);

    type Outcome =
      | { kind: 'not_found' }
      | { kind: 'revoked' }
      | { kind: 'replay'; userId: string }
      | { kind: 'expired' }
      | { kind: 'ok'; userId: string; rawToken: string; session: RefreshSession };

    const outcome: Outcome = await this.db.transaction(async (tx) => {
      const row = await tx<RefreshSessionRow>('refresh_sessions')
        .where({ token_hash: tokenHash })
        .forUpdate()
        .first();

      if (!row) return { kind: 'not_found' };
      const session = rowToRefreshSession(row);

      if (session.revokedAt) {
        // A revoked token that HAS a successor was rotated and is now being
        // replayed → treat as compromise and revoke the whole family. A token
        // revoked by logout / admin has no successor → it is simply invalid.
        if (!session.replacedBySessionId) return { kind: 'revoked' };

        await this.repo.revokeAllForUser(session.userId, tx);
        await this.audit.record(
          {
            action: AuditAction.REFRESH_TOKEN_REUSE_DETECTED,
            entityType: AuditEntityType.REFRESH_SESSION,
            entityId: session.id,
            actorUserId: session.userId,
            metadata: { reason: 'rotated refresh token replayed — all sessions revoked' },
            context: ctx.audit,
          },
          tx,
        );
        return { kind: 'replay', userId: session.userId };
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await this.repo.markRevoked(session.id, null, tx);
        return { kind: 'expired' };
      }

      const rawNext = generateRawToken();
      const next = await this.repo.create(
        {
          userId: session.userId,
          tokenHash: hashToken(rawNext),
          expiresAt: secondsFromNow(this.tokens.refreshTokenTtlSeconds()),
          userAgent: ctx.userAgent ?? session.userAgent,
          ip: ctx.ip ?? session.ip,
        },
        tx,
      );
      await this.repo.markRevoked(session.id, next.id, tx);
      return { kind: 'ok', userId: session.userId, rawToken: rawNext, session: next };
    });

    switch (outcome.kind) {
      case 'ok':
        return { userId: outcome.userId, rawToken: outcome.rawToken, session: outcome.session };
      case 'replay':
        this.log.warn({ userId: outcome.userId }, 'refresh token replay detected');
        throw new UnauthorizedError('Refresh token has been revoked', {
          code: ErrorCode.INVALID_REFRESH_TOKEN,
        });
      case 'expired':
        throw new UnauthorizedError('Refresh token has expired', {
          code: ErrorCode.INVALID_REFRESH_TOKEN,
        });
      case 'revoked':
        throw new UnauthorizedError('Refresh token has been revoked', {
          code: ErrorCode.INVALID_REFRESH_TOKEN,
        });
      case 'not_found':
        throw new UnauthorizedError('Invalid refresh token', {
          code: ErrorCode.INVALID_REFRESH_TOKEN,
        });
    }
  }

  /** Revoke a single session identified by its raw token. Idempotent. */
  async revokeByRawToken(
    rawToken: string,
    expectedUserId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const session = await this.repo.findByTokenHash(hashToken(rawToken), trx);
    if (!session || session.userId !== expectedUserId) return false;
    await this.repo.markRevoked(session.id, null, trx);
    return true;
  }

  /** Revoke a single session identified by its id (e.g. the access token's `sid`). */
  async revokeBySessionId(
    sessionId: string,
    expectedUserId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const session = await this.repo.findById(sessionId, trx);
    if (!session || session.userId !== expectedUserId) return false;
    await this.repo.markRevoked(session.id, null, trx);
    return true;
  }

  async revokeAllForUser(
    userId: string,
    actor: { actorUserId: string | null; context?: AuditContext },
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const count = await this.repo.revokeAllForUser(userId, tx);
      await this.audit.record(
        {
          action: AuditAction.SESSIONS_REVOKED,
          entityType: AuditEntityType.REFRESH_SESSION,
          entityId: userId,
          actorUserId: actor.actorUserId,
          metadata: { revokedSessions: count },
          context: actor.context,
        },
        tx,
      );
      return count;
    });
  }
}
