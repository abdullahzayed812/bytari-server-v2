import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { computeFarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';
import { FarmSubscriptionPolicy } from '../domain/farm-subscription.policy.js';
import type {
  ApproveRenewalInput,
  CreateRenewalRequestInput,
  FarmSubscriptionRenewalRequest,
  ListRenewalRequestsFilter,
  SetSubscriptionInput,
} from '../domain/farm-subscription.types.js';
import type { FarmSubscriptionRenewalRepository } from '../infrastructure/farm-subscription-renewal.repository.js';

export interface FarmSubscriptionActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Farm subscription management + the owner-submits/admin-reviews renewal
 * workflow (spec §4/§5/§6). Subscription validity is ALWAYS computed
 * server-side from stored dates vs `now()` — never trusted from the client,
 * never stored as a separate (driftable) status column.
 */
export class FarmSubscriptionService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly renewals: FarmSubscriptionRenewalRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'farm-subscription-service' });
  }

  /** Direct admin/supervisor set — also used internally by `approveRenewal`. */
  async setSubscription(
    organizationId: string,
    input: SetSubscriptionInput,
    actor: FarmSubscriptionActor,
  ): Promise<void> {
    FarmSubscriptionPolicy.assertValidPeriod(input.startDate, input.endDate);
    await this.db.transaction(async (tx) => {
      await this.renewals.setSubscriptionDates(
        organizationId,
        { startDate: input.startDate, endDate: input.endDate },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.FARM_SUBSCRIPTION_SET,
          entityType: AuditEntityType.ORGANIZATION,
          entityId: organizationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, startDate: input.startDate, endDate: input.endDate },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('farm.subscription.set', {
      organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  }

  async requestRenewal(
    organization: { id: string; ownerUserId: string },
    input: CreateRenewalRequestInput,
    actor: FarmSubscriptionActor,
  ): Promise<FarmSubscriptionRenewalRequest> {
    FarmSubscriptionPolicy.assertOwner(organization, actor.actorUserId);

    const dates = await this.renewals.getSubscriptionDates(organization.id);
    const status = computeFarmSubscriptionStatus(dates.startDate, dates.endDate);
    FarmSubscriptionPolicy.assertExpired(status);

    const open = await this.renewals.findPendingForOrganization(organization.id);
    if (open) {
      throw new ConflictError('An open subscription renewal request already exists for this farm', {
        code: ErrorCode.RENEWAL_REQUEST_ALREADY_PENDING,
      });
    }

    const created = await this.renewals.create({
      organizationId: organization.id,
      requestedByUserId: actor.actorUserId,
      note: input.note?.trim() || null,
      previousSubscriptionEndDate: dates.endDate,
    });

    await this.audit.record({
      action: AuditAction.FARM_SUBSCRIPTION_RENEWAL_REQUESTED,
      entityType: AuditEntityType.FARM_SUBSCRIPTION_RENEWAL_REQUEST,
      entityId: created.id,
      actorUserId: actor.actorUserId,
      metadata: { organizationId: organization.id },
      context: actor.context,
    });

    this.events.publish('farm.subscription.renewal.requested', {
      requestId: created.id,
      organizationId: organization.id,
    });

    return created;
  }

  async listRenewalRequests(
    organizationId: string,
    filter: ListRenewalRequestsFilter,
  ): Promise<{ items: FarmSubscriptionRenewalRequest[]; total: number }> {
    return this.renewals.listForOrganization(organizationId, filter);
  }

  async approveRenewal(
    organizationId: string,
    requestId: string,
    input: ApproveRenewalInput,
    actor: FarmSubscriptionActor,
  ): Promise<FarmSubscriptionRenewalRequest> {
    FarmSubscriptionPolicy.assertValidPeriod(input.startDate, input.endDate);
    const request = await this.loadForOrganization(organizationId, requestId);
    FarmSubscriptionPolicy.assertPending(request);

    const resolved = await this.db.transaction(async (tx) => {
      const updated = await this.renewals.resolve(
        requestId,
        'APPROVED',
        {
          decidedBy: actor.actorUserId,
          decisionReason: null,
          newSubscriptionStartDate: input.startDate,
          newSubscriptionEndDate: input.endDate,
        },
        tx,
      );
      if (!updated) {
        throw new ConflictError('This renewal request has already been resolved', {
          code: ErrorCode.RENEWAL_REQUEST_NOT_PENDING,
        });
      }
      await this.renewals.setSubscriptionDates(
        organizationId,
        { startDate: input.startDate, endDate: input.endDate },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.FARM_SUBSCRIPTION_RENEWAL_APPROVED,
          entityType: AuditEntityType.FARM_SUBSCRIPTION_RENEWAL_REQUEST,
          entityId: requestId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, startDate: input.startDate, endDate: input.endDate },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });

    this.events.publish('farm.subscription.renewal.approved', { requestId, organizationId });
    return resolved;
  }

  async rejectRenewal(
    organizationId: string,
    requestId: string,
    reason: string,
    actor: FarmSubscriptionActor,
  ): Promise<FarmSubscriptionRenewalRequest> {
    const request = await this.loadForOrganization(organizationId, requestId);
    FarmSubscriptionPolicy.assertPending(request);

    const resolved = await this.renewals.resolve(requestId, 'REJECTED', {
      decidedBy: actor.actorUserId,
      decisionReason: reason.trim(),
    });
    if (!resolved) {
      throw new ConflictError('This renewal request has already been resolved', {
        code: ErrorCode.RENEWAL_REQUEST_NOT_PENDING,
      });
    }

    await this.audit.record({
      action: AuditAction.FARM_SUBSCRIPTION_RENEWAL_REJECTED,
      entityType: AuditEntityType.FARM_SUBSCRIPTION_RENEWAL_REQUEST,
      entityId: requestId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId, reason },
      context: actor.context,
    });

    this.events.publish('farm.subscription.renewal.rejected', { requestId, organizationId });
    return resolved;
  }

  private async loadForOrganization(
    organizationId: string,
    requestId: string,
  ): Promise<FarmSubscriptionRenewalRequest> {
    const request = await this.renewals.findById(requestId);
    if (!request || request.organizationId !== organizationId) {
      throw new NotFoundError('Subscription renewal request not found');
    }
    return request;
  }
}

