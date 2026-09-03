import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PoultryFlock } from '../domain/farm.types.js';
import { FarmPolicy } from '../domain/farm.policy.js';
import { PoultryOpsAuditAction, PoultryOpsAuditEntity } from '../domain/poultry-ops.constants.js';
import type {
  BatchSummary,
  CreateDailyRecordInput,
  ListDailyRecordsFilter,
  PoultryDailyRecord,
  UpdateDailyRecordInput,
  WeeklySummary,
} from '../domain/poultry-ops.types.js';
import type { FarmExpenseRepository } from '../infrastructure/farm-expense.repository.js';
import type { PoultryDailyRecordRepository } from '../infrastructure/poultry-daily-record.repository.js';
import type { PoultryFlockRepository } from '../infrastructure/poultry-flock.repository.js';

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
 * summary cards on the Farm Details screen. Every aggregate is derived from
 * `poultry_daily_records` — nothing is stored or hardcoded.
 *
 * Always scoped to one flock, which is always scoped to one FARM organization
 * (route: `withOrganization` → `authorizeOrg('farm.daily_record.*')` →
 * `withPoultryFlock`).
 */
export class PoultryDailyRecordService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly records: PoultryDailyRecordRepository,
    private readonly flocks: PoultryFlockRepository,
    private readonly expenses: FarmExpenseRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'poultry-daily-record-service' });
  }

  private async loadFlock(organizationId: string, flockId: string): Promise<PoultryFlock> {
    const flock = await this.flocks.findByIdForOrganization(flockId, organizationId);
    if (!flock) throw new NotFoundError('Poultry flock not found');
    return flock;
  }

  async list(
    organizationId: string,
    flockId: string,
    filter: ListDailyRecordsFilter,
  ): Promise<{ items: PoultryDailyRecord[]; total: number }> {
    await this.loadFlock(organizationId, flockId);
    return this.records.listForFlock(flockId, filter);
  }

  async get(
    organizationId: string,
    flockId: string,
    recordId: string,
  ): Promise<PoultryDailyRecord> {
    await this.loadFlock(organizationId, flockId);
    const record = await this.records.findByIdForFlock(recordId, flockId);
    if (!record) throw new NotFoundError('Daily record not found');
    return record;
  }

  async create(
    organizationId: string,
    flockId: string,
    input: CreateDailyRecordInput,
    actor: FarmActor,
  ): Promise<PoultryDailyRecord> {
    const flock = await this.loadFlock(organizationId, flockId);
    FarmPolicy.assertFlockMutable(flock);
    if (new Date(`${input.recordDate}T00:00:00Z`) > new Date()) {
      throw new BadRequestError('recordDate cannot be in the future');
    }
    const existing = await this.records.findByFlockAndDate(flockId, input.recordDate);
    if (existing) {
      throw new ConflictError('A daily record already exists for that date', {
        code: ErrorCode.POULTRY_DAILY_RECORD_DUPLICATE_DATE,
      });
    }

    const record = await this.db.transaction(async (tx) => {
      const created = await this.records.create(
        { ...input, poultryFlockId: flockId, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      // Keep the flock's headline average weight in step with the latest record.
      if (input.averageWeightGrams != null) {
        await this.flocks.update(flockId, { averageWeightGrams: input.averageWeightGrams }, tx);
      }
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_DAILY_RECORD_CREATED,
          entityType: PoultryOpsAuditEntity.POULTRY_DAILY_RECORD,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, recordDate: input.recordDate },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('poultry.daily_record.created', {
      poultryFlockId: flockId,
      organizationId,
      recordId: record.id,
    });
    return record;
  }

  async update(
    organizationId: string,
    flockId: string,
    recordId: string,
    patch: UpdateDailyRecordInput,
    actor: FarmActor,
  ): Promise<PoultryDailyRecord> {
    const flock = await this.loadFlock(organizationId, flockId);
    FarmPolicy.assertFlockMutable(flock);
    const existing = await this.records.findByIdForFlock(recordId, flockId);
    if (!existing) throw new NotFoundError('Daily record not found');

    const updated = await this.db.transaction(async (tx) => {
      const r = await this.records.update(recordId, patch, tx);
      if (patch.averageWeightGrams != null) {
        await this.flocks.update(flockId, { averageWeightGrams: patch.averageWeightGrams }, tx);
      }
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_DAILY_RECORD_UPDATED,
          entityType: PoultryOpsAuditEntity.POULTRY_DAILY_RECORD,
          entityId: recordId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId, fields: Object.keys(patch) },
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
    flockId: string,
    recordId: string,
    actor: FarmActor,
  ): Promise<void> {
    await this.loadFlock(organizationId, flockId);
    const existing = await this.records.findByIdForFlock(recordId, flockId);
    if (!existing) throw new NotFoundError('Daily record not found');

    await this.db.transaction(async (tx) => {
      await this.records.deleteById(recordId, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.POULTRY_DAILY_RECORD_DELETED,
          entityType: PoultryOpsAuditEntity.POULTRY_DAILY_RECORD,
          entityId: recordId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, poultryFlockId: flockId },
          context: actor.context,
        },
        tx,
      );
    });
  }

  /** The "الدفعة رقم N" card — every figure derived from the flock + its records. */
  async batchSummary(organizationId: string, flockId: string): Promise<BatchSummary> {
    const flock = await this.loadFlock(organizationId, flockId);
    const [agg, flockExpenses, latestWeight] = await Promise.all([
      this.records.aggregateForFlock(flockId),
      this.expenses.sumForFlock(flockId),
      this.records.latestWeightForFlock(flockId),
    ]);

    const initial = flock.initialBirdCount ?? flock.birdCount;
    const currentBirdCount = Math.max(0, initial - agg.totalMortality);
    const arrival = new Date(`${flock.arrivalDate}T00:00:00Z`);
    const ageDays = Math.max(
      0,
      Math.floor((Date.now() - arrival.getTime()) / (24 * 60 * 60 * 1000)),
    );
    const averageWeightGrams = flock.averageWeightGrams ?? latestWeight;
    const totalExpenses = round2(agg.totalExpenses + flockExpenses);

    let estimatedProfit: number | null = null;
    if (flock.targetPricePerKg != null && averageWeightGrams != null) {
      const weightKg = Number(averageWeightGrams) / 1000;
      const revenue = currentBirdCount * weightKg * Number(flock.targetPricePerKg);
      estimatedProfit = round2(revenue - totalExpenses);
    }

    return {
      flockId: flock.id,
      batchNumber: flock.batchNumber,
      status: flock.status,
      birdType: flock.birdType,
      name: flock.name,
      arrivalDate: flock.arrivalDate,
      initialBirdCount: initial,
      currentBirdCount,
      totalMortality: agg.totalMortality,
      ageDays,
      ageWeeks: Math.floor(ageDays / 7),
      ageMonths: Math.floor(ageDays / 30),
      averageWeightGrams: averageWeightGrams ?? null,
      targetPricePerKg: flock.targetPricePerKg,
      expectedSaleDate: flock.expectedSaleDate,
      totalExpenses,
      estimatedProfit,
      recordsCount: agg.recordsCount,
    };
  }

  /** The "ملخص الأسبوع" card — all values from the week's daily records. */
  async weeklySummary(
    organizationId: string,
    flockId: string,
    weekOf: string | undefined,
  ): Promise<WeeklySummary> {
    await this.loadFlock(organizationId, flockId);
    const anchor = weekOf ?? new Date().toISOString().slice(0, 10);
    const { start, end } = weekBounds(anchor);
    const rows = await this.records.listInRange(flockId, start, end);

    const n = rows.length;
    const sum = (pick: (r: PoultryDailyRecord) => number): number =>
      rows.reduce((acc, r) => acc + pick(r), 0);
    const totalMortality = sum((r) => r.mortalityCount);
    const totalFeedKg = round2(sum((r) => Number(r.feedKg)));
    const totalWaterLiters = round2(sum((r) => Number(r.waterLiters)));
    const totalExpenses = round2(sum((r) => Number(r.expenseAmount)));

    const weighed = rows.filter((r) => r.averageWeightGrams != null);
    const weightChangeGrams =
      weighed.length >= 2
        ? round2(
            Number(weighed[weighed.length - 1]!.averageWeightGrams) -
              Number(weighed[0]!.averageWeightGrams),
          )
        : null;

    return {
      flockId,
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
      weightChangeGrams,
    };
  }
}
