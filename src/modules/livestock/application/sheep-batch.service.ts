import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { deleteReplacedObjects } from '../../../shared/storage/replaced-objects.js';
import { FarmPolicy } from '../../farms/domain/farm.policy.js';
import { SheepBatchPolicy } from '../domain/sheep-batch.policy.js';
import {
  toSheepBatchDTO,
  type CreateSheepBatchInput,
  type ListSheepBatchesFilter,
  type SheepBatchDTO,
  type UpdateSheepBatchInput,
} from '../domain/sheep-batch.types.js';
import type { SheepBatchRepository } from '../infrastructure/sheep-batch.repository.js';
import {
  deleteSoldBatchExpenses,
  deleteSoldBatchHealthRecords,
  lockBatchStatus,
} from '../../farms/infrastructure/sold-batch-expenses.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface OrgRef {
  id: string;
  type: string;
}

/**
 * Sheep batch lifecycle, always scoped to one FARM organization — mirrors
 * `server/src/modules/farms/application/poultry-flock.service.ts` exactly.
 */
export class SheepBatchService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly batches: SheepBatchRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'sheep-batch-service' });
  }

  async create(
    org: OrgRef,
    input: CreateSheepBatchInput,
    actor: FarmActor,
  ): Promise<SheepBatchDTO> {
    FarmPolicy.assertFarmOrganization(org);

    const batch = await this.db.transaction(async (tx) => {
      const batchNumber = await this.batches.nextBatchNumber(org.id, tx);
      const created = await this.batches.create(
        {
          organizationId: org.id,
          name: input.name,
          breed: input.breed ?? null,
          headCount: input.headCount,
          lambCount: input.lambCount ?? null,
          maleCount: input.maleCount ?? null,
          femaleCount: input.femaleCount ?? null,
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
          action: AuditAction.SHEEP_BATCH_CREATED,
          entityType: AuditEntityType.SHEEP_BATCH,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: org.id, sheepBatchId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('sheep.batch.created', { sheepBatchId: batch.id, organizationId: org.id });
    return toSheepBatchDTO(batch);
  }

  async get(organizationId: string, batchId: string): Promise<SheepBatchDTO> {
    const batch = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!batch) throw new NotFoundError('Sheep batch not found');
    return toSheepBatchDTO(batch);
  }

  async list(
    organizationId: string,
    filter: ListSheepBatchesFilter,
  ): Promise<{ items: SheepBatchDTO[]; total: number }> {
    const { items, total } = await this.batches.listForOrganization(organizationId, filter);
    return { items: items.map(toSheepBatchDTO), total };
  }

  async update(
    organizationId: string,
    batchId: string,
    patch: UpdateSheepBatchInput,
    actor: FarmActor,
  ): Promise<SheepBatchDTO> {
    const existing = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!existing) throw new NotFoundError('Sheep batch not found');
    const onlyStatusChange = Object.keys(patch).length === 1 && patch.status !== undefined;
    if (!onlyStatusChange) SheepBatchPolicy.assertBatchMutable(existing);

    let caseImageKeys: string[] = [];
    const updated = await this.db.transaction(async (tx) => {
      // ACTIVE → CLOSED is the sale: decided on the locked row, and its
      // expenses, treatments, vaccinations and sick cases go in this same
      // transaction (a failed sale keeps them all).
      const statusBefore = await lockBatchStatus(tx, 'SHEEP', batchId);
      const batch = await this.batches.update(batchId, patch, tx);
      const sold = patch.status === 'CLOSED' && statusBefore !== 'CLOSED';
      const soldExpenses = sold ? await deleteSoldBatchExpenses(tx, 'SHEEP', batchId) : undefined;
      const soldHealth = sold
        ? await deleteSoldBatchHealthRecords(tx, 'SHEEP', batchId)
        : undefined;
      caseImageKeys = soldHealth?.caseImageKeys ?? [];
      await this.audit.record(
        {
          action: AuditAction.SHEEP_BATCH_UPDATED,
          entityType: AuditEntityType.SHEEP_BATCH,
          entityId: batchId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            sheepBatchId: batchId,
            fields: Object.keys(patch),
            ...(soldExpenses ? { soldExpenses } : {}),
            ...(soldHealth ? { soldRecords: soldHealth.purge } : {}),
          },
          context: actor.context,
        },
        tx,
      );
      return batch;
    });

    // After commit only: the deleted sick cases' images leave storage.
    await deleteReplacedObjects(this.storage, this.log, caseImageKeys, [], { batchId });

    this.events.publish('sheep.batch.updated', { sheepBatchId: batchId, organizationId });
    return toSheepBatchDTO(updated);
  }

  async delete(organizationId: string, batchId: string, actor: FarmActor): Promise<void> {
    const existing = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!existing) throw new NotFoundError('Sheep batch not found');

    await this.db.transaction(async (tx) => {
      const deleted = await this.batches.deleteById(batchId, tx);
      if (deleted !== 1) throw new NotFoundError('Sheep batch not found');
      await this.audit.record(
        {
          action: AuditAction.SHEEP_BATCH_DELETED,
          entityType: AuditEntityType.SHEEP_BATCH,
          entityId: batchId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, sheepBatchId: batchId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('sheep.batch.deleted', { sheepBatchId: batchId, organizationId });
  }
}
