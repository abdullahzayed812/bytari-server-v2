import type { Logger } from 'pino';
import {
  RealtimeAuthError,
  type ConnectionAuthenticator,
  type RealtimeHandshake,
  type RealtimePrincipal,
} from './types.js';

/**
 * Safe default: refuse every connection. Used when no real authenticator has
 * been wired (i.e. before Phase 2). Logs once so the gap is visible.
 */
export class DenyAllConnectionAuthenticator implements ConnectionAuthenticator {
  private warned = false;

  constructor(private readonly logger: Logger) {}

  authenticate(_handshake: RealtimeHandshake): Promise<RealtimePrincipal> {
    if (!this.warned) {
      this.logger.warn(
        'Realtime authenticator not configured — all WebSocket connections are refused. ' +
          'Phase 2 wires the JWT authenticator.',
      );
      this.warned = true;
    }
    return Promise.reject(new RealtimeAuthError('Realtime authentication is not configured'));
  }
}

/**
 * Development-only authenticator. Enabled by `REALTIME_ALLOW_ANONYMOUS=true`
 * (never in production). Reads an optional `x-debug-user-id` header / `userId`
 * query param so local tooling can exercise user-scoped delivery.
 */
export class AnonymousConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(private readonly logger: Logger) {
    this.logger.warn(
      'Realtime running with ANONYMOUS authenticator — do not use outside local development.',
    );
  }

  authenticate(handshake: RealtimeHandshake): Promise<RealtimePrincipal> {
    const header = handshake.headers['x-debug-user-id'];
    const debugUserId =
      (Array.isArray(header) ? header[0] : header) ?? handshake.query['userId'] ?? null;

    return Promise.resolve({
      userId: debugUserId,
      roles: [],
      isAnonymous: debugUserId === null,
      claims: {},
    });
  }
}
