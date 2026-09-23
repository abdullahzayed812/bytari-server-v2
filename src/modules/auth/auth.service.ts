import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ForbiddenError,
  InternalError,
  RateLimitError,
  UnauthorizedError,
} from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import type { RoleKey } from '../rbac/rbac.constants.js';
import type { PublicUser } from '../users/user.types.js';
import type { UserService } from '../users/user.service.js';
import type { EmailVerificationService } from './email-verification.service.js';
import type { PasswordService } from './password.service.js';
import type { RefreshSessionService } from './refresh-session.service.js';
import type { TokenService } from './token.service.js';
import type {
  AuthResult,
  AuthTokens,
  LoginInput,
  RegisterInput,
  RegisterResult,
  ResendVerificationResult,
} from './auth.types.js';

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
    private readonly emailVerification: EmailVerificationService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'auth-service' });
  }

  /**
   * Self-registration — ALWAYS starts `PENDING_VERIFICATION` (mandatory email
   * verification; see `USER_STATUSES` and `EmailVerificationService`). Tokens
   * ARE issued (unlike a `login()` attempt on an already-existing unverified
   * account — see `login()` below): the freshly-created account has nothing
   * to protect yet, and the registration screens need a session to finish
   * self-service steps started in the SAME flow (avatar photo, and — for a
   * veterinarian applicant — identity documents + the application itself)
   * before the user ever leaves the app. That token is NOT a "normal
   * authenticated session": `authenticate.middleware.ts`'s default guard
   * rejects it on every route except the small explicit self-service
   * allowlist (`createAuthenticate({ allowPendingVerification: true })`),
   * so it grants no access beyond finishing registration and verifying.
   */
  async register(input: RegisterInput, ctx: AuditContext): Promise<RegisterResult> {
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
          status: 'PENDING_VERIFICATION',
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

      const { code } = await this.emailVerification.issueCode(user.id, tx);
      const tokens = await this.issueTokens(user.id, ctx, tx);
      return { user, tokens, code };
    });

    // Email + avatar-URL resolution are I/O — always AFTER the transaction commits.
    await this.emailVerification.sendCodeEmail(result.user.email, result.user.firstName, result.code);
    await this.emailVerification.auditSent(result.user.id, { actorUserId: null, context: ctx });

    return {
      user: await this.users.toPublicUserWithAvatar(result.user),
      tokens: result.tokens,
      codeExpiresInSeconds: this.emailVerification.codeTtlSeconds,
    };
  }

  /**
   * Complete registration: check the code, flip the account to `ACTIVE`, and
   * issue a FULL, unrestricted session — the same `AuthResult` shape
   * `login()` returns, so the mobile app's existing "establish session" path
   * (persist tokens → `GET /auth/me`) needs no special-casing for this call.
   *
   * An unknown email and a wrong code are deliberately indistinguishable
   * (`EmailVerificationService.verify` only ever runs once a real `userId`
   * has been resolved — a miss here throws the exact same
   * `INVALID_VERIFICATION_CODE` a real account with a wrong code would).
   */
  async verifyEmail(
    input: { email: string; code: string },
    ctx: AuditContext,
  ): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user || user.status !== 'PENDING_VERIFICATION') {
      throw new BadRequestError('Invalid or expired verification code', {
        code: ErrorCode.INVALID_VERIFICATION_CODE,
      });
    }

    await this.emailVerification.verify(user.id, input.code);

    // `setStatus` writes its own `USER_ACTIVATED` audit entry (from/to/reason)
    // and runs its own transaction — reused as-is, not re-wrapped.
    const activated = await this.users.setStatus(
      user.id,
      'ACTIVE',
      { actorUserId: user.id, context: ctx },
      'email_verified',
    );
    await this.emailVerification.auditVerified(user.id, { actorUserId: user.id, context: ctx });

    const tokens = await this.db.transaction((tx) => this.issueTokens(user.id, ctx, tx));
    return { user: await this.users.toPublicUserWithAvatar(activated), tokens };
  }

  /**
   * Request a fresh code. Deliberately uniform for an unknown email or an
   * already-ACTIVE one (no account-enumeration signal) — only a real,
   * still-`PENDING_VERIFICATION` account actually gets a new code and a
   * cooldown-driven 429, mirroring `login()`'s "verify against a real hash
   * even when unknown" anti-enumeration pattern.
   */
  async resendVerification(email: string, ctx: AuditContext): Promise<ResendVerificationResult> {
    const user = await this.users.findByEmail(email);
    if (user && user.status === 'PENDING_VERIFICATION') {
      const waitSeconds = await this.emailVerification.resendAvailableInSeconds(user.id);
      if (waitSeconds > 0) {
        throw new RateLimitError(`Please wait ${waitSeconds}s before requesting another code`, {
          code: ErrorCode.RATE_LIMITED,
        });
      }
      const { code } = await this.db.transaction((tx) => this.emailVerification.issueCode(user.id, tx));
      await this.emailVerification.sendCodeEmail(user.email, user.firstName, code);
      await this.emailVerification.auditSent(user.id, { actorUserId: null, context: ctx });
    }
    return {
      codeExpiresInSeconds: this.emailVerification.codeTtlSeconds,
      resendAvailableInSeconds: this.emailVerification.resendCooldownSeconds,
    };
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

    return {
      user: await this.users.toPublicUserWithAvatar(user),
      roleKeys: await this.roles.getRoleKeysForUser(user.id),
    };
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
    // Correct credentials confirmed BEFORE this branches on status — an
    // unverified account never leaks its existence to a wrong password.
    if (user.status === 'PENDING_VERIFICATION') {
      throw new ForbiddenError('Email verification is required before you can sign in', {
        code: ErrorCode.EMAIL_VERIFICATION_REQUIRED,
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError(`Account is ${user.status.toLowerCase()}`, {
        code: ErrorCode.ACCOUNT_INACTIVE,
      });
    }

    const tokens = await this.db.transaction((tx) => this.issueTokens(user.id, ctx, tx));
    return { user: await this.users.toPublicUserWithAvatar(user), tokens };
  }

  async refresh(rawRefreshToken: string, ctx: AuditContext): Promise<{ tokens: AuthTokens }> {
    const rotated = await this.sessions.rotate(rawRefreshToken, {
      userAgent: ctx.userAgent,
      ip: ctx.ip,
      audit: ctx,
    });

    const user = await this.users.getByIdOrNull(rotated.userId);
    // A still-unverified account's token IS allowed to refresh — it was
    // deliberately issued at registration to carry the user through the rest
    // of registration (avatar/documents, then verification), which can take
    // longer than one access-token lifetime. `authenticate` middleware keeps
    // enforcing the narrow allowlist regardless of how the token was obtained.
    if (!user || (user.status !== 'ACTIVE' && user.status !== 'PENDING_VERIFICATION')) {
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
