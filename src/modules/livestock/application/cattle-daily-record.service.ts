import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { CattleBatch } from '../domain/cattle-batch.types.js';
import { CattleBatchPolicy } from '../domain/cattle-batch.policy.js';
import { CattleOpsAuditAction, CattleOpsAuditEntity } from '../domain/livestock-ops.constants.js';
import type {
  CreateCattleDailyRecordInput,
  ListCattleDailyRecordsFilter,
  CattleBatchSummary,
  CattleDailyRecord,
  CattleWeeklySummary,
  UpdateCattleDailyRecordInput,
} from '../domain/cattle-ops.types.js';
import type { FarmExpenseRepository } from '../../farms/infrastructure/farm-expense.repository.js';
import type { CattleDailyRecordRepository } from '../infrastructure/cattle-daily-record.repository.js';
import type { CattleBatchRepository } from '../infrastructure/cattle-batch.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Monday-anchored week that contains `date` (YYYY-MM-DD). */
function weekBounds(date: string): { start: string; end: string } {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()))
    throw new BadRequestError('weekOf must be a valid YYYY-MM-DD date');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - dow);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * The "البيانات اليومية" list + the server-computed "ملخص الأسبوع" and batch
 * summary cards on the Cattle Farm Details screen — mirrors
 * `PoultryDailyRecordService` exactly, plus the two new fields.
 */
export class CattleDailyRecordService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly records: CattleDailyRecordRepository,
    private readonly batches: CattleBatchRepository,
    private readonly expenses: FarmExpenseRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'cattle-daily-record-service' });
  }

  private async loadBatch(organizationId: string, batchId: string): Promise<CattleBatch> {
    const batch = await this.batches.findByIdForOrganization(batchId, organizationId);
    if (!batch) throw new NotFoundError('Cattle batch not found');
    return batch;
  }

  async list(
    organizationId: string,
    batchId: string,
    filter: ListCattleDailyRecordsFilter,
  ): Promise<{ items: CattleDailyRecord[]; total: number }> {
    await this.loadBatch(organizationId, batchId);
    return this.records.listForBatch(batchId, filter);
  }

  async get(organizationId: string, batchId: string, recordId: string): Promise<CattleDailyRecord> {
    await this.loadBatch(organizationId, batchId);
    const record = await this.records.findByIdForBatch(recordId, batchId);
    if (!record) throw new NotFoundError('Daily record not found');
    return record;
  }

  async create(
    organizationId: string,
    batchId: string,
    input: CreateCattleDailyRecordInput,
    actor: FarmActor,
  ): Promise<CattleDailyRecord> {
    const batch = await this.loadBatch(organizationId, batchId);
    CattleBatchPolicy.assertBatchMutable(batch);
    if (new Date(`${input.recordDate}T00:00:00Z`) > new Date()) {
      throw new BadRequestError('recordDate cannot be in the future');
    }
    const existing = await this.records.findByBatchAndDate(batchId, input.recordDate);
    if (existing) {
      throw new ConflictError('A daily record already exists for that date', {
        code: ErrorCode.CATTLE_DAILY_RECORD_DUPLICATE_DATE,
      });
    }

    const record = await this.db.transaction(async (tx) => {
      const created = await this.records.create(
        { ...input, cattleBatchId: batchId, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      if (input.averageWeightKg != null) {
        await this.batches.update(batchId, { averageWeightKg: input.averageWeightKg }, tx);
      }
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_DAILY_RECORD_CREATED,
          entityType: CattleOpsAuditEntity.CATTLE_DAILY_RECORD,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, recordDate: input.recordDate },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('cattle.daily_record.created', {
      cattleBatchId: batchId,
      organizationId,
      recordId: record.id,
    });
    return record;
  }

  async update(
    organizationId: string,
    batchId: string,
    recordId: string,
    patch: UpdateCattleDailyRecordInput,
    actor: FarmActor,
  ): Promise<CattleDailyRecord> {
    const batch = await this.loadBatch(organizationId, batchId);
    CattleBatchPolicy.assertBatchMutable(batch);
    const existing = await this.records.findByIdForBatch(recordId, batchId);
    if (!existing) throw new NotFoundError('Daily record not found');

    const updated = await this.db.transaction(async (tx) => {
      const r = await this.records.update(recordId, patch, tx);
      if (patch.averageWeightKg != null) {
        await this.batches.update(batchId, { averageWeightKg: patch.averageWeightKg }, tx);
      }
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_DAILY_RECORD_UPDATED,
          entityType: CattleOpsAuditEntity.CATTLE_DAILY_RECORD,
          entityId: recordId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return r;
    });
    return updated;
  }

  async delete(
    organizationId: string,
    batchId: string,
    recordId: string,
    actor: FarmActor,
  ): Promise<void> {
    await this.loadBatch(organizationId, batchId);
    const existing = await this.records.findByIdForBatch(recordId, batchId);
    if (!existing) throw new NotFoundError('Daily record not found');

    await this.db.transaction(async (tx) => {
      await this.records.deleteById(recordId, tx);
      await this.audit.record(
        {
          action: CattleOpsAuditAction.CATTLE_DAILY_RECORD_DELETED,
          entityType: CattleOpsAuditEntity.CATTLE_DAILY_RECORD,
          entityId: recordId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, cattleBatchId: batchId },
          context: actor.context,
        },
        tx,
      );
    });
  }

  /** The "الدفعة رقم N" card — every figure derived from the batch + its records. */
  async batchSummary(organizationId: string, batchId: string): Promise<CattleBatchSummary> {
    const batch = await this.loadBatch(organizationId, batchId);
    const [agg, batchExpenses, latestWeight] = await Promise.all([
      this.records.aggregateForBatch(batchId),
      this.expenses.sumForFlock(batchId),
      this.records.latestWeightForBatch(batchId),
    ]);

    const initial = batch.initialHeadCount ?? batch.headCount;
    const currentHeadCount = Math.max(0, initial - agg.totalMortality);
    const arrival = new Date(`${batch.arrivalDate}T00:00:00Z`);
    const ageDays = Math.max(
      0,
      Math.floor((Date.now() - arrival.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const averageWeightKg = batch.averageWeightKg ?? latestWeight;
    const totalExpenses = round2(agg.totalExpenses + batchExpenses);

    let estimatedProfit: number | null = null;
    if (batch.targetPricePerKg != null && averageWeightKg != null) {
      const revenue = currentHeadCount * Number(averageWeightKg) * Number(batch.targetPricePerKg);
      estimatedProfit = round2(revenue - totalExpenses);
    }

    return {
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      status: batch.status,
      breed: batch.breed,
      name: batch.name,
      arrivalDate: batch.arrivalDate,
      initialHeadCount: initial,
      currentHeadCount,
      totalMortality: agg.totalMortality,
      ageDays,
      ageWeeks: Math.floor(ageDays / 7),
      ageMonths: Math.floor(ageDays / 30),
      averageWeightKg: averageWeightKg ?? null,
      targetPricePerKg: batch.targetPricePerKg,
      expectedSaleDate: batch.expectedSaleDate,
      totalExpenses,
      estimatedProfit,
      recordsCount: agg.recordsCount,
    };
  }

  /** The "ملخص الأسبوع" card — all values from the week's daily records. */
  async weeklySummary(
    organizationId: string,
    batchId: string,
    weekOf: string | undefined,
  ): Promise<CattleWeeklySummary> {
    await this.loadBatch(organizationId, batchId);
    const anchor = weekOf ?? new Date().toISOString().slice(0, 10);
    const { start, end } = weekBounds(anchor);
    const rows = await this.records.listInRange(batchId, start, end);

    const n = rows.length;
    const sum = (pick: (r: CattleDailyRecord) => number): number =>
      rows.reduce((acc, r) => acc + pick(r), 0);
    const totalMortality = sum((r) => r.mortalityCount);
    const totalFeedKg = round2(sum((r) => Number(r.feedKg)));
    const totalWaterLiters = round2(sum((r) => Number(r.waterLiters)));
    const totalExpenses = round2(sum((r) => Number(r.expenseAmount)));

    const weighed = rows.filter((r) => r.averageWeightKg != null);
    const weightChangeKg =
      weighed.length >= 2
        ? round2(Number(weighed[weighed.length - 1]!.averageWeightKg) - Number(weighed[0]!.averageWeightKg))
        : null;

    return {
      batchId,
      weekStart: start,
      weekEnd: end,
      recordsCount: n,
      averageMortality: n ? round2(totalMortality / n) : 0,
      averageFeedKg: n ? round2(totalFeedKg / n) : 0,
      averageWaterLiters: n ? round2(totalWaterLiters / n) : 0,
      totalMortality,
      totalFeedKg,
      totalWaterLiters,
      totalExpenses,
      weightChangeKg,
    };
  }
}
