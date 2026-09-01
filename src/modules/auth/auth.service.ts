import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ForbiddenError, InternalError, UnauthorizedError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import type { RoleKey } from '../rbac/rbac.constants.js';
import { toPublicUser } from '../users/user.mapper.js';
import type { PublicUser } from '../users/user.types.js';
import type { UserService } from '../users/user.service.js';
import type { PasswordService } from './password.service.js';
import type { RefreshSessionService } from './refresh-session.service.js';
import type { TokenService } from './token.service.js';
import type { AuthResult, AuthTokens, LoginInput, RegisterInput } from './auth.types.js';

const DEFAULT_ROLE_KEY = 'PET_OWNER';

/**
 * Orchestrates the authentication use-cases (register / login / refresh /
 * logout). Delegates hashing, token signing and session storage to dedicated
 * services — it holds no crypto of its own.
 */
export class AuthService {
  private readonly log: Logger;
  private dummyHash: string | null = null;

  constructor(
    private readonly db: Knex,
    private readonly users: UserService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: RefreshSessionService,
    private readonly roles: RoleRepository,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'auth-service' });
  }

  async register(input: RegisterInput, ctx: AuditContext): Promise<AuthResult> {
    const passwordHash = await this.passwords.hash(input.password);

    const result = await this.db.transaction(async (tx) => {
      const user = await this.users.createUser(
        {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          gender: input.gender ?? null,
          country: input.country ?? null,
        },
        { actorUserId: null, context: ctx },
        tx,
      );

      const role = await this.roles.findByKey(DEFAULT_ROLE_KEY, tx);
      if (!role) throw new InternalError(`Seed data missing: role "${DEFAULT_ROLE_KEY}"`);
      await this.roles.assignRole(user.id, role.id, null, tx);
      await this.audit.record(
        {
          action: AuditAction.ROLE_ASSIGNED,
          entityType: AuditEntityType.USER_ROLE,
          entityId: user.id,
          actorUserId: null,
          metadata: { roleKey: DEFAULT_ROLE_KEY, selfRegistered: true },
          context: ctx,
        },
        tx,
      );

      const tokens = await this.issueTokens(user.id, ctx, tx);
      return { user: toPublicUser(user), tokens };
    });

    return result;
  }

  /**
   * Admin-driven account creation. Hashes the password, creates the user with
   * an explicit set of roles, and audits with the admin as the actor. No tokens
   * are issued.
   */
  async adminCreateUser(
    input: RegisterInput & { roles?: RoleKey[] },
    actor: { actorUserId: string; context: AuditContext },
  ): Promise<{ user: PublicUser; roleKeys: string[] }> {
    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.db.transaction(async (tx) => {
      const created = await this.users.createUser(
        {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
        },
        { actorUserId: actor.actorUserId, context: actor.context },
        tx,
      );

      for (const roleKey of input.roles ?? []) {
        const role = await this.roles.findByKey(roleKey, tx);
        if (!role) throw new InternalError(`Seed data missing: role "${roleKey}"`);
        const added = await this.roles.assignRole(created.id, role.id, actor.actorUserId, tx);
        if (added) {
          await this.audit.record(
            {
              action: AuditAction.ROLE_ASSIGNED,
              entityType: AuditEntityType.USER_ROLE,
              entityId: created.id,
              actorUserId: actor.actorUserId,
              metadata: { roleKey },
              context: actor.context,
            },
            tx,
          );
        }
      }
      return created;
    });

    return { user: toPublicUser(user), roleKeys: await this.roles.getRoleKeysForUser(user.id) };
  }

  async login(input: LoginInput, ctx: AuditContext): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    // Verify against a real hash even when the user is unknown, to keep the
    // response time uniform and avoid leaking account existence.
    const hashToCheck = user?.passwordHash ?? (await this.getDummyHash());
    const passwordOk = await this.passwords.verify(hashToCheck, input.password);

    if (!user || !passwordOk) {
      throw new UnauthorizedError('Invalid email or password', {
        code: ErrorCode.INVALID_CREDENTIALS,
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError(`Account is ${user.status.toLowerCase()}`, {
        code: ErrorCode.ACCOUNT_INACTIVE,
      });
    }

    const tokens = await this.db.transaction((tx) => this.issueTokens(user.id, ctx, tx));
    return { user: toPublicUser(user), tokens };
  }

  async refresh(rawRefreshToken: string, ctx: AuditContext): Promise<{ tokens: AuthTokens }> {
    const rotated = await this.sessions.rotate(rawRefreshToken, {
      userAgent: ctx.userAgent,
      ip: ctx.ip,
      audit: ctx,
    });

    const user = await this.users.getByIdOrNull(rotated.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revokeBySessionId(rotated.session.id, rotated.userId);
      throw new UnauthorizedError('Account is not active', { code: ErrorCode.ACCOUNT_INACTIVE });
    }

    const access = await this.tokens.signAccessToken(rotated.userId, rotated.session.id);
    return {
      tokens: {
        accessToken: access.token,
        refreshToken: rotated.rawToken,
        tokenType: 'Bearer',
        expiresIn: access.expiresIn,
      },
    };
  }

  async logout(
    userId: string,
    opts: { refreshToken?: string; sessionId?: string | null },
  ): Promise<void> {
    if (opts.refreshToken) {
      await this.sessions.revokeByRawToken(opts.refreshToken, userId);
      return;
    }
    if (opts.sessionId) {
      await this.sessions.revokeBySessionId(opts.sessionId, userId);
    }
  }

  async logoutAll(userId: string, ctx: AuditContext): Promise<number> {
    return this.sessions.revokeAllForUser(userId, { actorUserId: userId, context: ctx });
  }

  private async issueTokens(
    userId: string,
    ctx: AuditContext,
    tx: Knex.Transaction,
  ): Promise<AuthTokens> {
    const { rawToken, session } = await this.sessions.issue(
      userId,
      { userAgent: ctx.userAgent, ip: ctx.ip, audit: ctx },
      tx,
    );
    const access = await this.tokens.signAccessToken(userId, session.id);
    return {
      accessToken: access.token,
      refreshToken: rawToken,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
    };
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await this.passwords.hash(randomBytes(24).toString('hex'));
    return this.dummyHash;
  }
}
