import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import { SignJWT, jwtVerify } from 'jose';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { AuthConfig } from '../../config/index.js';
import { durationToSeconds } from '../../shared/time/duration.js';

export interface AccessTokenResult {
  token: string;
  /** Lifetime in seconds (for the client to schedule a refresh). */
  expiresIn: number;
}

export interface VerifiedAccessToken {
  userId: string;
  sessionId: string | null;
}

/**
 * Stateless HS256 access-token issuing & verification. Refresh tokens are NOT
 * JWTs — they are opaque random strings managed by {@link RefreshSessionService}.
 */
export class TokenService {
  private readonly secret: Uint8Array;
  private readonly jwt: AuthConfig['jwt'];

  constructor(config: AuthConfig, logger: Logger) {
    this.jwt = config.jwt;
    let secret = config.jwt.accessSecret;
    if (!secret) {
      secret = randomBytes(48).toString('hex');
      logger.warn(
        'JWT_ACCESS_SECRET is not set — generated an ephemeral per-process secret. ' +
          'Tokens will not survive a restart. Set JWT_ACCESS_SECRET for anything beyond local dev.',
      );
    }
    this.secret = new TextEncoder().encode(secret);
  }

  async signAccessToken(userId: string, sessionId: string): Promise<AccessTokenResult> {
    const token = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.jwt.issuer)
      .setAudience(this.jwt.audience)
      .setIssuedAt()
      .setExpirationTime(this.jwt.accessTtl)
      .sign(this.secret);
    return { token, expiresIn: durationToSeconds(this.jwt.accessTtl) };
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.jwt.issuer,
        audience: this.jwt.audience,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new Error('token is missing a subject');
      }
      return {
        userId: payload.sub,
        sessionId: typeof payload.sid === 'string' ? payload.sid : null,
      };
    } catch (err) {
      throw new UnauthorizedError('Invalid or expired access token', {
        code: ErrorCode.INVALID_TOKEN,
        cause: err,
      });
    }
  }

  refreshTokenTtlSeconds(): number {
    return durationToSeconds(this.jwt.refreshTtl);
  }
}
