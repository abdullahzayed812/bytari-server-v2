import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { EventBus } from '../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RefreshSessionRepository } from '../auth/refresh-session.repository.js';
import { toPublicUser } from './user.mapper.js';
import { UserPolicy } from './user.policy.js';
import type { UserRepository } from './user.repository.js';
import type {
  CreateUserData,
  ListUsersFilter,
  PublicUser,
  User,
  UserStatus,
  VeterinarianStatus,
} from './user.types.js';

export interface ActorContext {
  actorUserId: string | null;
  context?: AuditContext;
}

const AVATAR_UPLOAD_URL_TTL_SECONDS = 600;

/**
 * User lifecycle & account-status operations. Registration/authentication logic
 * lives in `AuthService`; this service owns the user record itself.
 */
export class UserService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly users: UserRepository,
    private readonly sessions: RefreshSessionRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'user-service' });
  }

  getByIdOrNull(id: string, trx?: Knex.Transaction): Promise<User | null> {
    return this.users.findById(id, trx);
  }

  async getById(id: string, trx?: Knex.Transaction): Promise<User> {
    const user = await this.users.findById(id, trx);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  findByEmail(email: string, trx?: Knex.Transaction): Promise<User | null> {
    return this.users.findByEmail(email, trx);
  }

  list(filter: ListUsersFilter): Promise<{ items: User[]; total: number }> {
    return this.users.list(filter);
  }

  /**
   * Low-level create. Callers (registration, admin-create) provide the already
   * hashed password and decide the audit actor. Runs inside `trx` when given.
   */
  async createUser(
    data: CreateUserData,
    actor: ActorContext,
    trx?: Knex.Transaction,
  ): Promise<User> {
    const run = async (tx: Knex.Transaction): Promise<User> => {
      if (await this.users.existsByEmail(data.email, tx)) {
        throw new ConflictError('An account with this email already exists');
      }
      const user = await this.users.insert(data, tx);
      await this.audit.record(
        {
          action: AuditAction.USER_CREATED,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          actorUserId: actor.actorUserId,
          metadata: { email: user.email },
          context: actor.context,
        },
        tx,
      );
      return user;
    };

    const user = trx ? await run(trx) : await this.db.transaction(run);
    this.events.publish('user.registered', { userId: user.id, email: user.email });
    return user;
  }

  async updateProfile(
    id: string,
    patch: { firstName?: string; lastName?: string; phone?: string | null },
    actor: ActorContext,
  ): Promise<User> {
    return this.db.transaction(async (tx) => {
      const existing = await this.users.findById(id, tx);
      if (!existing) throw new NotFoundError('User not found');

      const updated = await this.users.update(id, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.USER_UPDATED,
          entityType: AuditEntityType.USER,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Change account status. SUSPENDED / DEACTIVATED also revoke every active
   * refresh session so the account cannot continue an existing login.
   */
  async setStatus(
    id: string,
    status: UserStatus,
    actor: ActorContext,
    reason?: string,
  ): Promise<User> {
    if (status !== 'ACTIVE' && actor.actorUserId && actor.actorUserId === id) {
      throw new ForbiddenError('You cannot suspend or deactivate your own account');
    }

    const auditAction =
      status === 'ACTIVE'
        ? AuditAction.USER_ACTIVATED
        : status === 'SUSPENDED'
          ? AuditAction.USER_SUSPENDED
          : AuditAction.USER_DEACTIVATED;

    const updated = await this.db.transaction(async (tx) => {
      const existing = await this.users.findById(id, tx);
      if (!existing) throw new NotFoundError('User not found');
      if (existing.status === status) return existing;

      const user = await this.users.update(id, { status }, tx);

      let revokedSessions = 0;
      if (status !== 'ACTIVE') {
        revokedSessions = await this.sessions.revokeAllForUser(id, tx);
      }

      await this.audit.record(
        {
          action: auditAction,
          entityType: AuditEntityType.USER,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { from: existing.status, to: status, reason: reason ?? null, revokedSessions },
          context: actor.context,
        },
        tx,
      );
      return user;
    });

    this.events.publish('user.status.changed', { userId: id, status });
    return updated;
  }

  /** Apply a veterinarian-status transition. Used by the veterinarian workflow inside its own trx. */
  applyVeterinarianStatus(
    id: string,
    status: VeterinarianStatus,
    trx: Knex.Transaction,
  ): Promise<User> {
    return this.users.update(id, { veterinarianStatus: status }, trx);
  }

  // --- avatar (presigned direct-to-storage upload) -----------------

  async requestAvatarUploadUrl(
    userId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.getById(userId);
    UserPolicy.assertAvatarUploadRequest(input.mimeType, input.size);

    // The server ALWAYS generates the key — the client never controls it.
    const storageKey = buildObjectKey(StoragePrefix.userAvatars, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: AVATAR_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });

    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: AVATAR_UPLOAD_URL_TTL_SECONDS,
    };
  }

  async finalizeAvatar(
    userId: string,
    actor: ActorContext,
    input: { storageKey: string; mimeType: string; filename: string },
  ): Promise<PublicUser> {
    UserPolicy.assertKeyBelongsToPrefix(input.storageKey, StoragePrefix.userAvatars);

    // Storage I/O ALWAYS happens before the transaction opens.
    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    UserPolicy.assertRegisteredAvatar(realMime, head.size);

    const existing = await this.getById(userId);
    const previousKey = existing.avatarKey;

    const updated = await this.db.transaction(async (tx) => {
      const user = await this.users.update(userId, { avatarKey: input.storageKey }, tx);
      await this.audit.record(
        {
          action: AuditAction.USER_AVATAR_UPDATED,
          entityType: AuditEntityType.USER,
          entityId: userId,
          actorUserId: actor.actorUserId,
          // NB: no storage key / URL / credentials in audit metadata.
          metadata: { userId, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
      return user;
    });

    // Best-effort cleanup of the replaced object AFTER commit (§28 pattern).
    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error(
          { err, userId },
          'failed to delete replaced avatar storage object — needs a sweep',
        );
      }
    }

    this.events.publish('user.avatar.updated', { userId });
    return toPublicUser(updated);
  }
}
