import type { Logger } from 'pino';
import {
  RealtimeAuthError,
  type ConnectionAuthenticator,
  type RealtimeHandshake,
  type RealtimePrincipal,
} from '../../../infra/realtime/index.js';
import type { RoleRepository } from '../../rbac/role.repository.js';
import type { TokenService } from '../../auth/token.service.js';
import type { UserService } from '../../users/user.service.js';

/**
 * WebSocket connection authenticator. Reuses the SAME access-token verification
 * and user reload as the REST `authenticate` middleware — there is no second
 * login mechanism. The token is taken from the `Authorization: Bearer` header
 * or, for browser clients that cannot set upgrade headers, an `access_token`
 * query parameter.
 *
 * A rejected/expired token, a missing account or a non-ACTIVE account all
 * refuse the connection.
 */
export class JwtConnectionAuthenticator implements ConnectionAuthenticator {
  constructor(
    private readonly deps: {
      tokens: TokenService;
      users: UserService;
      roles: RoleRepository;
      logger: Logger;
    },
  ) {}

  private extractToken(handshake: RealtimeHandshake): string | null {
    const header = handshake.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (raw && raw.startsWith('Bearer ')) return raw.slice(7).trim();
    const q = handshake.query['access_token'];
    return q && q.length > 0 ? q : null;
  }

  async authenticate(handshake: RealtimeHandshake): Promise<RealtimePrincipal> {
    const token = this.extractToken(handshake);
    if (!token) throw new RealtimeAuthError('Missing access token');

    let userId: string;
    try {
      ({ userId } = await this.deps.tokens.verifyAccessToken(token));
    } catch {
      throw new RealtimeAuthError('Invalid or expired access token');
    }

    const user = await this.deps.users.getByIdOrNull(userId);
    if (!user) throw new RealtimeAuthError('Account no longer exists');
    if (user.status !== 'ACTIVE')
      throw new RealtimeAuthError(`Account is ${user.status.toLowerCase()}`);

    return {
      userId: user.id,
      roles: await this.deps.roles.getRoleKeysForUser(user.id),
      isAnonymous: false,
      claims: {},
    };
  }
}
