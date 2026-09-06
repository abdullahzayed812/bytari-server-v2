import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { CattleOpsAuditAction, CattleOpsAuditEntity } from '../domain/livestock-ops.constants.js';
import type {
  CreateCattleHealthEventInput,
  ListCattleHealthEventsFilter,
  CattleHealthEvent,
  UpdateCattleHealthEventInput,
} from '../domain/cattle-ops.types.js';
import type { CattleBatchRepository } from '../infrastructure/cattle-batch.repository.js';
import type { CattleHealthEventRepository } from '../infrastructure/cattle-health-event.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

/** "العلاجات واللقاحات" — treatments + vaccinations, scoped to one cattle batch. */
export class CattleHealthEventService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly events: CattleHealthEventRepository,
    private readonly batches: CattleBatchRepository,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'cattle-health-event-service' });
  }

  private async assertBatch(organizationId: string, batchId: string): Promise<void> {
    const batch = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!batch) throw new NotFoundError('Cattle batch not found');
  }

  async list(
    organizationId: string,
    batchId: string,
    filter: ListCattleHealthEventsFilter,
  ): Promise<{ items: CattleHealthEvent[]; total: number }> {
    await this.assertBatch(organizationId, batchId);
    return this.events.listForBatch(batchId, filter);
  }

  async get(organizationId: string, batchId: string, eventId: string): Promise<CattleHealthEvent> {
    await this.assertBatch(organizationId, batchId);
    const event = await this.events.findByIdForBatch(eventId, batchId);
    if (!event) throw new NotFoundError('Health event not found');
    return event;
  }

  async create(
    organizationId: string,
    batchId: string,
    input: CreateCattleHealthEventInput,
    actor: FarmActor,
  ): Promise<CattleHealthEvent> {
    await this.assertBatch(organizationId, batchId);
    const event = await this.db.transaction(async (tx) => {
      const created = await this.events.create(
        { ...input, cattleBatchId: batchId, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_HEALTH_EVENT_CREATED,
          entityType: CattleOpsAuditEntity.CATTLE_HEALTH_EVENT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, kind: input.kind },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.bus.publish('cattle.health_event.created', {
      organizationId,
      cattleBatchId: batchId,
      eventId: event.id,
    });
    return event;
  }

  async update(
    organizationId: string,
    batchId: string,
    eventId: string,
    patch: UpdateCattleHealthEventInput,
    actor: FarmActor,
  ): Promise<CattleHealthEvent> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.events.findByIdForBatch(eventId, batchId);
    if (!existing) throw new NotFoundError('Health event not found');
    return this.db.transaction(async (tx) => {
      const updated = await this.events.update(eventId, patch, tx);
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_HEALTH_EVENT_UPDATED,
          entityType: CattleOpsAuditEntity.CATTLE_HEALTH_EVENT,
          entityId: eventId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }

  async delete(
    organizationId: string,
    batchId: string,
    eventId: string,
    actor: FarmActor,
  ): Promise<void> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.events.findByIdForBatch(eventId, batchId);
    if (!existing) throw new NotFoundError('Health event not found');
    await this.db.transaction(async (tx) => {
      await this.events.deleteById(eventId, tx);
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_HEALTH_EVENT_DELETED,
          entityType: CattleOpsAuditEntity.CATTLE_HEALTH_EVENT,
          entityId: eventId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
