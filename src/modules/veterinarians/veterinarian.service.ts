import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '../../shared/errors/app-error.js';
import type { EventBus } from '../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { RoleRepository } from '../rbac/role.repository.js';
import type { UserService } from '../users/user.service.js';
import type { VeterinarianRepository } from './veterinarian.repository.js';
import type { PendingApplicationSummary, VeterinarianApplication } from './veterinarian.types.js';

export interface VetActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Veterinarian approval workflow.
 *
 *   apply → PENDING → (admin) approve → APPROVED  (+ VETERINARIAN role granted)
 *                   → (admin) reject  → REJECTED  (may re-apply)
 *
 * `users.veterinarian_status` is kept in sync inside the same transaction as the
 * application row. Veterinarian-only authorization is gated separately by
 * `AuthorizationService` (status must be APPROVED).
 */
export class VeterinarianService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly applications: VeterinarianRepository,
    private readonly users: UserService,
    private readonly roles: RoleRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-service' });
  }

  async apply(
    userId: string,
    input: { note?: string | null },
    ctx: AuditContext,
  ): Promise<VeterinarianApplication> {
    const application = await this.db.transaction(async (tx) => {
      const user = await this.users.getById(userId, tx);
      if (user.veterinarianStatus === 'PENDING') {
        throw new ConflictError('A veterinarian application is already pending');
      }
      if (user.veterinarianStatus === 'APPROVED') {
        throw new ConflictError('This account is already an approved veterinarian');
      }

      const created = await this.applications.create({ userId, note: input.note ?? null }, tx);
      await this.users.applyVeterinarianStatus(userId, 'PENDING', tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_APPLICATION_CREATED,
          entityType: AuditEntityType.VETERINARIAN_APPLICATION,
          entityId: created.id,
          actorUserId: userId,
          metadata: { userId },
          context: ctx,
        },
        tx,
      );
      return created;
    });

    this.events.publish('veterinarian.application.submitted', {
      userId,
      applicationId: application.id,
    });
    return application;
  }

  async getStatus(userId: string): Promise<{
    veterinarianStatus: string;
    application: VeterinarianApplication | null;
  }> {
    const user = await this.users.getById(userId);
    const application = await this.applications.findLatestByUser(userId);
    return { veterinarianStatus: user.veterinarianStatus, application };
  }

  listPending(
    page: number,
    pageSize: number,
  ): Promise<{ items: PendingApplicationSummary[]; total: number }> {
    return this.applications.listPending(page, pageSize);
  }

  async approve(targetUserId: string, actor: VetActor): Promise<VeterinarianApplication> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot approve your own veterinarian application');
    }

    const decided = await this.db.transaction(async (tx) => {
      const pending = await this.applications.findPendingByUser(targetUserId, tx);
      if (!pending) throw new NotFoundError('No pending veterinarian application for this user');

      const application = await this.applications.decide(
        pending.id,
        { status: 'APPROVED', decidedBy: actor.actorUserId },
        tx,
      );
      await this.users.applyVeterinarianStatus(targetUserId, 'APPROVED', tx);

      const vetRole = await this.roles.findByKey('VETERINARIAN', tx);
      if (!vetRole) throw new InternalError('Seed data missing: role "VETERINARIAN"');
      const roleAdded = await this.roles.assignRole(
        targetUserId,
        vetRole.id,
        actor.actorUserId,
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_APPROVED,
          entityType: AuditEntityType.VETERINARIAN_APPLICATION,
          entityId: application.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, roleGranted: roleAdded },
          context: actor.context,
        },
        tx,
      );
      if (roleAdded) {
        await this.audit.record(
          {
            action: AuditAction.ROLE_ASSIGNED,
            entityType: AuditEntityType.USER_ROLE,
            entityId: targetUserId,
            actorUserId: actor.actorUserId,
            metadata: { roleKey: 'VETERINARIAN', reason: 'veterinarian approval' },
            context: actor.context,
          },
          tx,
        );
      }
      return application;
    });

    this.events.publish('veterinarian.approved', { userId: targetUserId });
    return decided;
  }

  async reject(
    targetUserId: string,
    reason: string,
    actor: VetActor,
  ): Promise<VeterinarianApplication> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot reject your own veterinarian application');
    }

    const decided = await this.db.transaction(async (tx) => {
      const pending = await this.applications.findPendingByUser(targetUserId, tx);
      if (!pending) throw new NotFoundError('No pending veterinarian application for this user');

      const application = await this.applications.decide(
        pending.id,
        { status: 'REJECTED', decidedBy: actor.actorUserId, decisionReason: reason },
        tx,
      );
      await this.users.applyVeterinarianStatus(targetUserId, 'REJECTED', tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_REJECTED,
          entityType: AuditEntityType.VETERINARIAN_APPLICATION,
          entityId: application.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, reason },
          context: actor.context,
        },
        tx,
      );
      return application;
    });

    this.events.publish('veterinarian.rejected', { userId: targetUserId });
    return decided;
  }
}
