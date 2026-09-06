import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { FarmPolicy } from '../domain/farm.policy.js';
import { PoultryFlockPolicy } from '../domain/poultry-flock.policy.js';
import {
  toPoultryFlockDTO,
  type CreatePoultryFlockInput,
  type ListPoultryFlocksFilter,
  type PoultryFlockDTO,
  type UpdatePoultryFlockInput,
} from '../domain/poultry-flock.types.js';
import type { PoultryFlockRepository } from '../infrastructure/poultry-flock.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface OrgRef {
  id: string;
  type: string;
}

/**
 * Poultry flock lifecycle, always scoped to one FARM organization. Every flock
 * belongs to exactly one farm (DB composite FK to `organizations(id, type)`),
 * and every lookup is scoped by `organization_id` so a member of Farm A can
 * never touch Farm B's flocks.
 */
export class PoultryFlockService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly flocks: PoultryFlockRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'poultry-flock-service' });
  }

  async create(
    org: OrgRef,
    input: CreatePoultryFlockInput,
    actor: FarmActor,
  ): Promise<PoultryFlockDTO> {
    FarmPolicy.assertFarmOrganization(org);

    const flock = await this.db.transaction(async (tx) => {
      const batchNumber = await this.flocks.nextBatchNumber(org.id, tx);
      const created = await this.flocks.create(
        {
          organizationId: org.id,
          name: input.name,
          birdType: input.birdType,
          birdCount: input.birdCount,
          arrivalDate: input.arrivalDate,
          notes: input.notes ?? null,
          createdByUserId: actor.actorUserId,
          batchNumber,
          initialBirdCount: input.initialBirdCount ?? input.birdCount,
          averageWeightGrams: input.averageWeightGrams ?? null,
          targetPricePerKg: input.targetPricePerKg ?? null,
          expectedSaleDate: input.expectedSaleDate ?? null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.POULTRY_FLOCK_CREATED,
          entityType: AuditEntityType.POULTRY_FLOCK,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: org.id, poultryFlockId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('poultry.flock.created', {
      poultryFlockId: flock.id,
      organizationId: org.id,
    });
    return toPoultryFlockDTO(flock);
  }

  async get(organizationId: string, flockId: string): Promise<PoultryFlockDTO> {
    const flock = await this.flocks.findByIdForOrganization(flockId, organizationId);
    if (!flock) throw new NotFoundError('Poultry flock not found');
    return toPoultryFlockDTO(flock);
  }

  async list(
    organizationId: string,
    filter: ListPoultryFlocksFilter,
  ): Promise<{ items: PoultryFlockDTO[]; total: number }> {
    const { items, total } = await this.flocks.listForOrganization(organizationId, filter);
    return { items: items.map(toPoultryFlockDTO), total };
  }

  async update(
    organizationId: string,
    flockId: string,
    patch: UpdatePoultryFlockInput,
    actor: FarmActor,
  ): Promise<PoultryFlockDTO> {
    const existing = await this.flocks.findByIdForOrganization(flockId, organizationId);
    if (!existing) throw new NotFoundError('Poultry flock not found');
    // A CLOSED flock is historical; only re-opening it (status change) or an
    // explicit status field is allowed. Reject content edits on a closed flock.
    const onlyStatusChange = Object.keys(patch).length === 1 && patch.status !== undefined;
    if (!onlyStatusChange) PoultryFlockPolicy.assertFlockMutable(existing);

    const updated = await this.db.transaction(async (tx) => {
      const flock = await this.flocks.update(flockId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.POULTRY_FLOCK_UPDATED,
          entityType: AuditEntityType.POULTRY_FLOCK,
          entityId: flockId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            poultryFlockId: flockId,
            fields: Object.keys(patch),
          },
          context: actor.context,
        },
        tx,
      );
      return flock;
    });

    this.events.publish('poultry.flock.updated', {
      poultryFlockId: flockId,
      organizationId,
    });
    return toPoultryFlockDTO(updated);
  }

  async delete(organizationId: string, flockId: string, actor: FarmActor): Promise<void> {
    const existing = await this.flocks.findByIdForOrganization(flockId, organizationId);
    if (!existing) throw new NotFoundError('Poultry flock not found');

    await this.db.transaction(async (tx) => {
      const deleted = await this.flocks.deleteById(flockId, tx);
      if (deleted !== 1) throw new NotFoundError('Poultry flock not found');
      await this.audit.record(
        {
          action: AuditAction.POULTRY_FLOCK_DELETED,
          entityType: AuditEntityType.POULTRY_FLOCK,
          entityId: flockId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('poultry.flock.deleted', {
      poultryFlockId: flockId,
      organizationId,
    });
  }
}
