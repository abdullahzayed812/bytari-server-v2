import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { FarmPolicy } from '../../farms/domain/farm.policy.js';
import { CattleBatchPolicy } from '../domain/cattle-batch.policy.js';
import {
  toCattleBatchDTO,
  type CreateCattleBatchInput,
  type ListCattleBatchesFilter,
  type CattleBatchDTO,
  type UpdateCattleBatchInput,
} from '../domain/cattle-batch.types.js';
import type { CattleBatchRepository } from '../infrastructure/cattle-batch.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface OrgRef {
  id: string;
  type: string;
}

/**
 * Cattle batch lifecycle, always scoped to one FARM organization — mirrors
 * `server/src/modules/farms/application/poultry-flock.service.ts` exactly.
 */
export class CattleBatchService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly batches: CattleBatchRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'cattle-batch-service' });
  }

  async create(org: OrgRef, input: CreateCattleBatchInput, actor: FarmActor): Promise<CattleBatchDTO> {
    FarmPolicy.assertFarmOrganization(org);

    const batch = await this.db.transaction(async (tx) => {
      const batchNumber = await this.batches.nextBatchNumber(org.id, tx);
      const created = await this.batches.create(
        {
          organizationId: org.id,
          name: input.name,
          breed: input.breed ?? null,
          headCount: input.headCount,
          calfCount: input.calfCount ?? null,
          bullCount: input.bullCount ?? null,
          cowCount: input.cowCount ?? null,
          arrivalDate: input.arrivalDate,
          notes: input.notes ?? null,
          createdByUserId: actor.actorUserId,
          batchNumber,
          initialHeadCount: input.initialHeadCount ?? input.headCount,
          averageWeightKg: input.averageWeightKg ?? null,
          targetPricePerKg: input.targetPricePerKg ?? null,
          expectedSaleDate: input.expectedSaleDate ?? null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.CATTLE_BATCH_CREATED,
          entityType: AuditEntityType.CATTLE_BATCH,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: org.id, cattleBatchId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('cattle.batch.created', { cattleBatchId: batch.id, organizationId: org.id });
    return toCattleBatchDTO(batch);
  }

  async get(organizationId: string, batchId: string): Promise<CattleBatchDTO> {
    const batch = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!batch) throw new NotFoundError('Cattle batch not found');
    return toCattleBatchDTO(batch);
  }

  async list(
    organizationId: string,
    filter: ListCattleBatchesFilter,
  ): Promise<{ items: CattleBatchDTO[]; total: number }> {
    const { items, total } = await this.batches.listForOrganization(organizationId, filter);
    return { items: items.map(toCattleBatchDTO), total };
  }

  async update(
    organizationId: string,
    batchId: string,
    patch: UpdateCattleBatchInput,
    actor: FarmActor,
  ): Promise<CattleBatchDTO> {
    const existing = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!existing) throw new NotFoundError('Cattle batch not found');
    const onlyStatusChange = Object.keys(patch).length === 1 && patch.status !== undefined;
    if (!onlyStatusChange) CattleBatchPolicy.assertBatchMutable(existing);

    const updated = await this.db.transaction(async (tx) => {
      const batch = await this.batches.update(batchId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.CATTLE_BATCH_UPDATED,
          entityType: AuditEntityType.CATTLE_BATCH,
          entityId: batchId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return batch;
    });

    this.events.publish('cattle.batch.updated', { cattleBatchId: batchId, organizationId });
    return toCattleBatchDTO(updated);
  }

  async delete(organizationId: string, batchId: string, actor: FarmActor): Promise<void> {
    const existing = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!existing) throw new NotFoundError('Cattle batch not found');

    await this.db.transaction(async (tx) => {
      const deleted = await this.batches.deleteById(batchId, tx);
      if (deleted !== 1) throw new NotFoundError('Cattle batch not found');
      await this.audit.record(
        {
          action: AuditAction.CATTLE_BATCH_DELETED,
          entityType: AuditEntityType.CATTLE_BATCH,
          entityId: batchId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('cattle.batch.deleted', { cattleBatchId: batchId, organizationId });
  }
}
