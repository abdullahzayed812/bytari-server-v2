import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import type { TraderRepository } from '../infrastructure/trader.repository.js';
import type { RegisterTraderInput, TraderApplicationSummary, TraderProfile } from '../domain/trader.types.js';
import type { TraderStatus } from '../domain/trader.constants.js';

export interface TraderActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Trader registration workflow (Poultry Markets module). Mirrors the
 * veterinarian-application lifecycle (register → PENDING → admin approve/
 * reject) but the profile is a single mutable row per user — reapply after
 * REJECTED overwrites the same row in place rather than creating a new
 * application record. `users.trader_status` is kept in sync inside the same
 * transaction as the profile row, exactly like `applyVeterinarianStatus`.
 *
 * Deliberately no role grant on approval (unlike veterinarian → VETERINARIAN
 * role) — trader capability gating is pure status, the spec never asked for
 * a role.
 */
export class TraderService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly traders: TraderRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'trader-service' });
  }

  async register(
    userId: string,
    input: RegisterTraderInput,
    ctx: AuditContext,
  ): Promise<TraderProfile> {
    const user = await this.users.getById(userId);
    if (user.traderStatus === 'PENDING') {
      throw new ConflictError('A trader registration is already pending');
    }
    if (user.traderStatus === 'APPROVED') {
      throw new ConflictError('This account is already an approved trader');
    }
    if (user.traderStatus === 'SUSPENDED') {
      throw new ConflictError('This trader account is suspended — contact an administrator');
    }

    const existing = await this.traders.findByUserId(userId);
    const termsAcceptedAt = new Date();

    const profile = await this.db.transaction(async (tx) => {
      const saved = existing
        ? await this.traders.reapply(userId, input, termsAcceptedAt, tx)
        : await this.traders.create(userId, input, termsAcceptedAt, tx);
      await this.users.applyTraderStatus(userId, 'PENDING', tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_APPLICATION_CREATED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: saved.id,
          actorUserId: userId,
          metadata: { userId, reapply: Boolean(existing) },
          context: ctx,
        },
        tx,
      );
      return saved;
    });

    this.events.publish('trader.application.submitted', { userId, traderProfileId: profile.id });
    return profile;
  }

  async getStatus(
    userId: string,
  ): Promise<{ traderStatus: TraderStatus; profile: TraderProfile | null }> {
    const user = await this.users.getById(userId);
    const profile = await this.traders.findByUserId(userId);
    return { traderStatus: user.traderStatus, profile };
  }

  async list(
    status: TraderStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ items: TraderApplicationSummary[]; total: number }> {
    return this.traders.list(status, page, pageSize);
  }

  async getOne(userId: string): Promise<TraderApplicationSummary> {
    const { items } = await this.traders.list(undefined, 1, 1000);
    const found = items.find((i) => i.userId === userId);
    if (!found) throw new NotFoundError('No trader profile for this user');
    return found;
  }

  private async requirePending(targetUserId: string): Promise<TraderProfile> {
    const profile = await this.traders.findByUserId(targetUserId);
    if (!profile || profile.status !== 'PENDING') {
      throw new NotFoundError('No pending trader registration for this user');
    }
    return profile;
  }

  async approve(targetUserId: string, actor: TraderActor): Promise<TraderProfile> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot approve your own trader registration');
    }
    await this.requirePending(targetUserId);

    const decided = await this.db.transaction(async (tx) => {
      const profile = await this.traders.decide(
        targetUserId,
        { status: 'APPROVED', decidedBy: actor.actorUserId },
        tx,
      );
      await this.users.applyTraderStatus(targetUserId, 'APPROVED', tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_APPROVED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId },
          context: actor.context,
        },
        tx,
      );
      return profile;
    });

    this.events.publish('trader.approved', { userId: targetUserId });
    return decided;
  }

  async reject(targetUserId: string, reason: string, actor: TraderActor): Promise<TraderProfile> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot reject your own trader registration');
    }
    await this.requirePending(targetUserId);

    const decided = await this.db.transaction(async (tx) => {
      const profile = await this.traders.decide(
        targetUserId,
        { status: 'REJECTED', decidedBy: actor.actorUserId, decisionReason: reason },
        tx,
      );
      await this.users.applyTraderStatus(targetUserId, 'REJECTED', tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_REJECTED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, reason },
          context: actor.context,
        },
        tx,
      );
      return profile;
    });

    this.events.publish('trader.rejected', { userId: targetUserId });
    return decided;
  }

  async suspend(
    targetUserId: string,
    reason: string | null,
    actor: TraderActor,
  ): Promise<TraderProfile> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot suspend your own trader account');
    }
    const profile = await this.traders.findByUserId(targetUserId);
    if (!profile || profile.status !== 'APPROVED') {
      throw new NotFoundError('No approved trader account for this user');
    }

    const decided = await this.db.transaction(async (tx) => {
      const updated = await this.traders.decide(
        targetUserId,
        { status: 'SUSPENDED', decidedBy: actor.actorUserId, decisionReason: reason },
        tx,
      );
      await this.users.applyTraderStatus(targetUserId, 'SUSPENDED', tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_SUSPENDED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: updated.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, reason },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });

    this.events.publish('trader.suspended', { userId: targetUserId });
    return decided;
  }

  async reactivate(targetUserId: string, actor: TraderActor): Promise<TraderProfile> {
    const profile = await this.traders.findByUserId(targetUserId);
    if (!profile || profile.status !== 'SUSPENDED') {
      throw new NotFoundError('No suspended trader account for this user');
    }

    const decided = await this.db.transaction(async (tx) => {
      const updated = await this.traders.decide(
        targetUserId,
        { status: 'APPROVED', decidedBy: actor.actorUserId, decisionReason: null },
        tx,
      );
      await this.users.applyTraderStatus(targetUserId, 'APPROVED', tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_REACTIVATED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: updated.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });

    this.events.publish('trader.reactivated', { userId: targetUserId });
    return decided;
  }
}
