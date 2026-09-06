import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { SheepOpsAuditAction, SheepOpsAuditEntity } from '../domain/livestock-ops.constants.js';
import type {
  CreateSheepHealthEventInput,
  ListSheepHealthEventsFilter,
  SheepHealthEvent,
  UpdateSheepHealthEventInput,
} from '../domain/sheep-ops.types.js';
import type { SheepBatchRepository } from '../infrastructure/sheep-batch.repository.js';
import type { SheepHealthEventRepository } from '../infrastructure/sheep-health-event.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

/** "العلاجات واللقاحات" — treatments + vaccinations, scoped to one sheep batch. */
export class SheepHealthEventService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly events: SheepHealthEventRepository,
    private readonly batches: SheepBatchRepository,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'sheep-health-event-service' });
  }

  private async assertBatch(organizationId: string, batchId: string): Promise<void> {
    const batch = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!batch) throw new NotFoundError('Sheep batch not found');
  }

  async list(
    organizationId: string,
    batchId: string,
    filter: ListSheepHealthEventsFilter,
  ): Promise<{ items: SheepHealthEvent[]; total: number }> {
    await this.assertBatch(organizationId, batchId);
    return this.events.listForBatch(batchId, filter);
  }

  async get(organizationId: string, batchId: string, eventId: string): Promise<SheepHealthEvent> {
    await this.assertBatch(organizationId, batchId);
    const event = await this.events.findByIdForBatch(eventId, batchId);
    if (!event) throw new NotFoundError('Health event not found');
    return event;
  }

  async create(
    organizationId: string,
    batchId: string,
    input: CreateSheepHealthEventInput,
    actor: FarmActor,
  ): Promise<SheepHealthEvent> {
    await this.assertBatch(organizationId, batchId);
    const event = await this.db.transaction(async (tx) => {
      const created = await this.events.create(
        { ...input, sheepBatchId: batchId, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: SheepOpsAuditAction.SHEEP_HEALTH_EVENT_CREATED,
          entityType: SheepOpsAuditEntity.SHEEP_HEALTH_EVENT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, sheepBatchId: batchId, kind: input.kind },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.bus.publish('sheep.health_event.created', {
      organizationId,
      sheepBatchId: batchId,
      eventId: event.id,
    });
    return event;
  }

  async update(
    organizationId: string,
    batchId: string,
    eventId: string,
    patch: UpdateSheepHealthEventInput,
    actor: FarmActor,
  ): Promise<SheepHealthEvent> {
    await this.assertBatch(organizationId, batchId);
    const existing = await this.events.findByIdForBatch(eventId, batchId);
    if (!existing) throw new NotFoundError('Health event not found');
    return this.db.transaction(async (tx) => {
      const updated = await this.events.update(eventId, patch, tx);
      await this.audit.record(
        {
          action: SheepOpsAuditAction.SHEEP_HEALTH_EVENT_UPDATED,
          entityType: SheepOpsAuditEntity.SHEEP_HEALTH_EVENT,
          entityId: eventId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, sheepBatchId: batchId, fields: Object.keys(patch) },
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
          action: SheepOpsAuditAction.SHEEP_HEALTH_EVENT_DELETED,
          entityType: SheepOpsAuditEntity.SHEEP_HEALTH_EVENT,
          entityId: eventId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, sheepBatchId: batchId },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
