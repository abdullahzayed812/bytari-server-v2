import type { Knex } from 'knex';
import {
  rowToFarmExpense,
  type CreateFarmExpenseInput,
  type FarmExpense,
  type FarmExpenseRow,
  type ListFarmExpensesFilter,
  type UpdateFarmExpenseInput,
} from '../domain/poultry-ops.types.js';
import { BATCH_LINKS, batchLinkPatch, type FarmBatchKind } from '../domain/farm-batch-link.js';
import { selectBatchLink } from './farm-batch-link.js';

const TABLE = 'farm_expenses';

/** Daily-record tables whose `expense_amount` counts in the "المصاريف" totals. */
const DAILY_EXPENSE_SOURCES = [
  {
    kind: 'POULTRY',
    recordTable: 'poultry_daily_records',
    batchTable: 'poultry_flocks',
    batchColumn: 'poultry_flock_id',
  },
  {
    kind: 'SHEEP',
    recordTable: 'sheep_daily_records',
    batchTable: 'sheep_batches',
    batchColumn: 'sheep_batch_id',
  },
  {
    kind: 'CATTLE',
    recordTable: 'cattle_daily_records',
    batchTable: 'cattle_batches',
    batchColumn: 'cattle_batch_id',
  },
] as const;

export class FarmExpenseRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<FarmExpense | null> {
    const conn = this.conn(trx);
    const row = (await selectBatchLink(
      conn as Knex,
      conn(`${TABLE} as e`)
        .where({ 'e.id': id, 'e.organization_id': organizationId })
        .select('e.*'),
      'e',
    ).first()) as FarmExpenseRow | undefined;
    return row ? rowToFarmExpense(row) : null;
  }

  async create(
    data: CreateFarmExpenseInput & { organizationId: string; createdByUserId: string },
    trx: Knex.Transaction,
  ): Promise<FarmExpense> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'FARM',
        ...batchLinkPatch(data),
        category: data.category,
        amount: data.amount,
        description: data.description ?? null,
        spent_on: data.spentOn,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as FarmExpenseRow[];
    if (!row) throw new Error('farm expense insert did not return a row');
    const created = await this.findByIdForOrganization(row.id, row.organization_id, trx);
    if (!created) throw new Error('farm expense insert did not return a row');
    return created;
  }

  async update(
    id: string,
    patch: UpdateFarmExpenseInput,
    trx: Knex.Transaction,
  ): Promise<FarmExpense> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.amount !== undefined) dbPatch.amount = patch.amount;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.spentOn !== undefined) dbPatch.spent_on = patch.spentOn;
    Object.assign(dbPatch, batchLinkPatch(patch));
    const [row] = await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning(['id', 'organization_id']);
    if (!row) throw new Error('farm expense not found after update');
    const updated = await this.findByIdForOrganization(row.id, row.organization_id, trx);
    if (!updated) throw new Error('farm expense not found after update');
    return updated;
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  /**
   * "المصاريف" list: the farm's MANUAL expense cards only, newest added first
   * (a just-added expense is always on top, whatever date it was spent on).
   * Daily-record expenses are not cards — their amounts reach the screen
   * through the summary totals ({@link sumCurrentInRange} / {@link currentTotals}).
   */
  async listForOrganization(
    organizationId: string,
    filter: ListFarmExpensesFilter,
  ): Promise<{ items: FarmExpense[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<FarmExpenseRow>(`${TABLE} as e`).where(
        'e.organization_id',
        organizationId,
      );
      if (filter.category) qb.andWhere('e.category', filter.category);
      if (filter.poultryFlockId) qb.andWhere('e.poultry_flock_id', filter.poultryFlockId);
      if (filter.sheepBatchId) qb.andWhere('e.sheep_batch_id', filter.sheepBatchId);
      if (filter.cattleBatchId) qb.andWhere('e.cattle_batch_id', filter.cattleBatchId);
      if (filter.from) qb.andWhere('e.spent_on', '>=', filter.from);
      if (filter.to) qb.andWhere('e.spent_on', '<=', filter.to);
      return qb;
    };

    const countRow = (await base().count<{ count: string }>({ count: '*' }).first()) as
      { count: string } | undefined;
    const total = Number(countRow?.count ?? 0);
    const rows: FarmExpenseRow[] = await selectBatchLink(this.db, base().select('e.*'), 'e')
      .orderBy([
        { column: 'e.created_at', order: 'desc' },
        { column: 'e.id', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToFarmExpense), total };
  }

  /**
   * Total spent on the farm's CURRENT operation within `[from, to]` (inclusive
   * dates): manual expenses by `spent_on` + daily-record expenses by
   * `record_date` — the same lines the list shows, each counted once. Selling
   * a batch permanently deletes its expenses (`deleteSoldBatchExpenses`); the
   * CLOSED-batch exclusion here only still matters for batches sold before
   * that rule, whose expenses were kept. Farm-wide manual expenses (no batch)
   * always count.
   */
  async sumCurrentInRange(organizationId: string, from: string, to: string): Promise<number> {
    const { manual, daily } = await this.currentTotals(organizationId, { from, to });
    return manual + daily;
  }

  /**
   * The current operation's expenses, split by source: manual rows (farm-wide
   * or linked to an ACTIVE batch) and daily-record amounts of ACTIVE batches,
   * optionally within `[from, to]`.
   */
  async currentTotals(
    organizationId: string,
    range: { from?: string; to?: string } = {},
  ): Promise<{ manual: number; daily: number }> {
    const manualQ = this.db(`${TABLE} as e`)
      .leftJoin('poultry_flocks as f', 'f.id', 'e.poultry_flock_id')
      .leftJoin('sheep_batches as s', 's.id', 'e.sheep_batch_id')
      .leftJoin('cattle_batches as c', 'c.id', 'e.cattle_batch_id')
      .where('e.organization_id', organizationId)
      // Farm-wide rows (no batch) count; batch rows only while the batch is ACTIVE.
      .whereRaw(`COALESCE(f.status, s.status, c.status, 'ACTIVE') = 'ACTIVE'`);
    if (range.from) manualQ.andWhere('e.spent_on', '>=', range.from);
    if (range.to) manualQ.andWhere('e.spent_on', '<=', range.to);
    const manual = manualQ.sum<{ total: string | null }>({ total: 'e.amount' }).first();
    const daily = DAILY_EXPENSE_SOURCES.map((src) => {
      const qb = this.db(`${src.recordTable} as d`)
        .join(`${src.batchTable} as b`, 'b.id', `d.${src.batchColumn}`)
        .where('d.organization_id', organizationId)
        .andWhere('b.status', 'ACTIVE');
      if (range.from) qb.andWhere('d.record_date', '>=', range.from);
      if (range.to) qb.andWhere('d.record_date', '<=', range.to);
      return qb.sum<{ total: string | null }>({ total: 'd.expense_amount' }).first();
    });
    const [manualRow, ...dailyRows] = (await Promise.all([manual, ...daily])) as (
      { total: string | null } | undefined
    )[];
    return {
      manual: Number(manualRow?.total ?? 0),
      daily: dailyRows.reduce((acc, row) => acc + Number(row?.total ?? 0), 0),
    };
  }

  /** Total manual expenses attributed to one batch (for the batch-summary profit calc). */
  async sumForBatch(kind: FarmBatchKind, batchId: string): Promise<number> {
    const column = BATCH_LINKS.find((l) => l.kind === kind)!.column;
    const row = (await this.db(TABLE)
      .where(column, batchId)
      .sum<{ total: string | null }>({ total: 'amount' })
      .first()) as { total: string | null } | undefined;
    return Number(row?.total ?? 0);
  }
}
