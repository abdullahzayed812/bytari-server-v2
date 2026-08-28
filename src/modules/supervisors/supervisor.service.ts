import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.js';
import type { EventBus } from '../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { SupervisorDomain } from '../rbac/rbac.constants.js';
import type { UserService } from '../users/user.service.js';
import type { SupervisorRepository } from './supervisor.repository.js';
import type {
  ListSupervisorFilter,
  SupervisorAssignment,
  SupervisorAssignmentSummary,
} from './supervisor.types.js';

export interface SupervisorActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * System Supervisor assignment foundation. An Admin grants a user a
 * domain-scoped supervision responsibility. This is NOT a role — the user keeps
 * their global role(s) and additionally holds the assignment.
 */
export class SupervisorService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly assignments: SupervisorRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'supervisor-service' });
  }

  async assign(
    targetUserId: string,
    domain: SupervisorDomain,
    actor: SupervisorActor,
  ): Promise<SupervisorAssignment> {
    if (targetUserId === actor.actorUserId) {
      throw new ForbiddenError('You cannot assign a supervisor role to yourself');
    }

    const assignment = await this.db.transaction(async (tx) => {
      const target = await this.users.getById(targetUserId, tx);
      if (target.status !== 'ACTIVE') {
        throw new ConflictError('Cannot assign a supervisor role to a non-active account');
      }

      const existing = await this.assignments.findByUserAndDomain(targetUserId, domain, tx);
      let record: SupervisorAssignment;
      if (existing?.status === 'ACTIVE') {
        throw new ConflictError('User is already an active supervisor for this domain');
      } else if (existing) {
        record = await this.assignments.setStatus(existing.id, 'ACTIVE', actor.actorUserId, tx);
      } else {
        record = await this.assignments.create(
          { userId: targetUserId, domain, assignedBy: actor.actorUserId },
          tx,
        );
      }

      await this.audit.record(
        {
          action: AuditAction.SUPERVISOR_ASSIGNED,
          entityType: AuditEntityType.SYSTEM_SUPERVISOR_ASSIGNMENT,
          entityId: record.id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId, domain },
          context: actor.context,
        },
        tx,
      );
      return record;
    });

    this.events.publish('supervisor.assigned', {
      userId: targetUserId,
      domain,
      assignmentId: assignment.id,
    });
    return assignment;
  }

  list(
    filter: ListSupervisorFilter,
  ): Promise<{ items: SupervisorAssignmentSummary[]; total: number }> {
    return this.assignments.list(filter);
  }

  async remove(id: string, actor: SupervisorActor): Promise<SupervisorAssignment> {
    const updated = await this.db.transaction(async (tx) => {
      const existing = await this.assignments.findById(id, tx);
      if (!existing) throw new NotFoundError('Supervisor assignment not found');
      if (existing.status === 'INACTIVE') return existing;

      const record = await this.assignments.setStatus(id, 'INACTIVE', null, tx);
      await this.audit.record(
        {
          action: AuditAction.SUPERVISOR_REMOVED,
          entityType: AuditEntityType.SYSTEM_SUPERVISOR_ASSIGNMENT,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { targetUserId: existing.userId, domain: existing.domain },
          context: actor.context,
        },
        tx,
      );
      return record;
    });

    this.events.publish('supervisor.removed', { userId: updated.userId, domain: updated.domain });
    return updated;
  }

  getActiveDomainsForUser(userId: string): Promise<string[]> {
    return this.assignments.getActiveDomainsForUser(userId);
  }
}
