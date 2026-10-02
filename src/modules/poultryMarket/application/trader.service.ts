import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import type { TraderRepository } from '../infrastructure/trader.repository.js';
import {
  DEFAULT_TRADER_SUBSCRIPTION_DAYS,
  type RegisterTraderInput,
  type TraderApplicationSummary,
  type TraderProfile,
} from '../domain/trader.types.js';
import type { TraderStatus } from '../domain/trader.constants.js';

export interface TraderSubscriptionPeriod {
  startDate: string;
  endDate: string;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultPeriod(now = new Date()): TraderSubscriptionPeriod {
  const end = new Date(now.getTime() + DEFAULT_TRADER_SUBSCRIPTION_DAYS * 86_400_000);
  return { startDate: isoDay(now), endDate: isoDay(end) };
}

function assertValidPeriod(p: TraderSubscriptionPeriod): void {
  if (p.endDate < p.startDate) {
    throw new BadRequestError('The subscription end date must be on or after its start date', {
      code: ErrorCode.INVALID_SUBSCRIPTION_DATES,
    });
  }
}

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

  /** Approved traders waiting for the admin to renew their activation period. */
  countRenewalRequests(): Promise<number> {
    return this.traders.countRenewalRequests();
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

  /**
   * Approve a registration — which also STARTS its limited activation period
   * (the admin's dates, or one year from today).
   */
  async approve(
    targetUserId: string,
    actor: TraderActor,
    period?: TraderSubscriptionPeriod,
  ): Promise<TraderProfile> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot approve your own trader registration');
    }
    await this.requirePending(targetUserId);
    const activation = period ?? defaultPeriod();
    assertValidPeriod(activation);

    const decided = await this.db.transaction(async (tx) => {
      const profile = await this.traders.decide(
        targetUserId,
        { status: 'APPROVED', decidedBy: actor.actorUserId },
        tx,
      );
      await this.users.applyTraderStatus(targetUserId, 'APPROVED', tx);
      const activated = await this.traders.setSubscription(targetUserId, activation, tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_APPROVED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, ...activation },
          context: actor.context,
        },
        tx,
      );
      return activated;
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

  // --- activation period -------------------------------------------------

  /** Admin sets / renews a trader's activation period (`trader.admin.approve`). */
  async setSubscription(
    targetUserId: string,
    period: TraderSubscriptionPeriod,
    actor: TraderActor,
  ): Promise<TraderProfile> {
    assertValidPeriod(period);
    const profile = await this.traders.findByUserId(targetUserId);
    if (!profile || (profile.status !== 'APPROVED' && profile.status !== 'SUSPENDED')) {
      throw new NotFoundError('No approved trader account for this user');
    }
    const updated = await this.db.transaction(async (tx) => {
      const next = await this.traders.setSubscription(targetUserId, period, tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_SUBSCRIPTION_SET,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, ...period },
          context: actor.context,
        },
        tx,
      );
      return next;
    });
    this.events.publish('trader.subscription.set', { userId: targetUserId, ...period });
    return updated;
  }

  /** The trader asks for a renewal — only once the period has EXPIRED. */
  async requestRenewal(userId: string, actor: TraderActor): Promise<TraderProfile> {
    const profile = await this.traders.findByUserId(userId);
    if (!profile || profile.status !== 'APPROVED') {
      throw new NotFoundError('No approved trader account for this user');
    }
    if (profile.subscriptionStatus === 'ACTIVE') {
      throw new ConflictError('Your trader subscription is still active', {
        code: ErrorCode.SUBSCRIPTION_NOT_EXPIRED,
      });
    }
    if (profile.renewalRequestedAt) {
      throw new ConflictError('A renewal request is already pending', {
        code: ErrorCode.RENEWAL_REQUEST_ALREADY_PENDING,
      });
    }
    const updated = await this.db.transaction(async (tx) => {
      const next = await this.traders.markRenewalRequested(userId, tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_SUBSCRIPTION_RENEWAL_REQUESTED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { userId },
          context: actor.context,
        },
        tx,
      );
      return next;
    });
    this.events.publish('trader.subscription.renewal.requested', { userId });
    return updated;
  }

  /** Admin edit of a trader's registration details (`trader.admin.approve`). */
  async adminUpdate(
    targetUserId: string,
    patch: Parameters<TraderRepository['updateFields']>[1],
    actor: TraderActor,
  ): Promise<TraderProfile> {
    const profile = await this.traders.findByUserId(targetUserId);
    if (!profile) throw new NotFoundError('No trader registration for this user');
    return this.db.transaction(async (tx) => {
      const updated = await this.traders.updateFields(targetUserId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_UPDATED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Admin "حذف التاجر": the registration is removed (the user goes back to
   * NOT_REGISTERED and may register again later) and every live poultry / egg
   * advertisement of theirs is taken down (status REMOVED — kept for history),
   * in one transaction. The user account itself is untouched.
   */
  async adminRemove(targetUserId: string, actor: TraderActor): Promise<void> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot remove your own trader registration');
    }
    const profile = await this.traders.findByUserId(targetUserId);
    if (!profile) throw new NotFoundError('No trader registration for this user');
    await this.db.transaction(async (tx) => {
      const offersRemoved = {
        poultry: await tx('poultry_offers')
          .where({ trader_user_id: targetUserId, status: 'ACTIVE' })
          .update({ status: 'REMOVED', updated_at: tx.fn.now() }),
        egg: await tx('egg_offers')
          .where({ trader_user_id: targetUserId, status: 'ACTIVE' })
          .update({ status: 'REMOVED', updated_at: tx.fn.now() }),
      };
      await this.traders.deleteByUserId(targetUserId, tx);
      await this.users.applyTraderStatus(targetUserId, 'NOT_REGISTERED', tx);
      await this.audit.record(
        {
          action: AuditAction.TRADER_REMOVED,
          entityType: AuditEntityType.TRADER_PROFILE,
          entityId: profile.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, previousStatus: profile.status, offersRemoved },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('trader.removed', { userId: targetUserId });
  }
}
