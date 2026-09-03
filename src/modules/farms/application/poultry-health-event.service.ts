import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { PoultryOpsAuditAction, PoultryOpsAuditEntity } from '../domain/poultry-ops.constants.js';
import type {
  CreateHealthEventInput,
  ListHealthEventsFilter,
  PoultryHealthEvent,
  UpdateHealthEventInput,
} from '../domain/poultry-ops.types.js';
import type { PoultryFlockRepository } from '../infrastructure/poultry-flock.repository.js';
import type { PoultryHealthEventRepository } from '../infrastructure/poultry-health-event.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

/** "العلاجات واللقاحات" — treatments + vaccinations, scoped to one flock. */
export class PoultryHealthEventService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly events: PoultryHealthEventRepository,
    private readonly flocks: PoultryFlockRepository,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'poultry-health-event-service' });
  }

  private async assertFlock(organizationId: string, flockId: string): Promise<void> {
    const flock = await this.flocks.findByIdForOrganization(flockId, organizationId);
    if (!flock) throw new NotFoundError('Poultry flock not found');
  }

  async list(
    organizationId: string,
    flockId: string,
    filter: ListHealthEventsFilter,
  ): Promise<{ items: PoultryHealthEvent[]; total: number }> {
    await this.assertFlock(organizationId, flockId);
    return this.events.listForFlock(flockId, filter);
  }

  async get(organizationId: string, flockId: string, eventId: string): Promise<PoultryHealthEvent> {
    await this.assertFlock(organizationId, flockId);
    const event = await this.events.findByIdForFlock(eventId, flockId);
    if (!event) throw new NotFoundError('Health event not found');
    return event;
  }

  async create(
    organizationId: string,
    flockId: string,
    input: CreateHealthEventInput,
    actor: FarmActor,
  ): Promise<PoultryHealthEvent> {
    await this.assertFlock(organizationId, flockId);
    const event = await this.db.transaction(async (tx) => {
      const created = await this.events.create(
        { ...input, poultryFlockId: flockId, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_HEALTH_EVENT_CREATED,
          entityType: PoultryOpsAuditEntity.POULTRY_HEALTH_EVENT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, kind: input.kind },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.bus.publish('poultry.health_event.created', {
      organizationId,
      poultryFlockId: flockId,
      eventId: event.id,
    });
    return event;
  }

  async update(
    organizationId: string,
    flockId: string,
    eventId: string,
    patch: UpdateHealthEventInput,
    actor: FarmActor,
  ): Promise<PoultryHealthEvent> {
    await this.assertFlock(organizationId, flockId);
    const existing = await this.events.findByIdForFlock(eventId, flockId);
    if (!existing) throw new NotFoundError('Health event not found');
    return this.db.transaction(async (tx) => {
      const updated = await this.events.update(eventId, patch, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_HEALTH_EVENT_UPDATED,
          entityType: PoultryOpsAuditEntity.POULTRY_HEALTH_EVENT,
          entityId: eventId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }

  async delete(
    organizationId: string,
    flockId: string,
    eventId: string,
    actor: FarmActor,
  ): Promise<void> {
    await this.assertFlock(organizationId, flockId);
    const existing = await this.events.findByIdForFlock(eventId, flockId);
    if (!existing) throw new NotFoundError('Health event not found');
    await this.db.transaction(async (tx) => {
      await this.events.deleteById(eventId, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_HEALTH_EVENT_DELETED,
          entityType: PoultryOpsAuditEntity.POULTRY_HEALTH_EVENT,
          entityId: eventId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
