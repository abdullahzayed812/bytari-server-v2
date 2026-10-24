import type { Knex } from 'knex';
import {
  rowToFarmExpense,
  type CreateFarmExpenseInput,
  type FarmExpense,
  type FarmExpenseRow,
  type ListFarmExpensesFilter,
  type UpdateFarmExpenseInput,
} from '../domain/poultry-ops.types.js';

const TABLE = 'farm_expenses';

/** Daily-record tables whose `expense_amount` also belongs in "المصاريف". */
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
    const row = await this.conn(trx)<FarmExpenseRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
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
        poultry_flock_id: data.poultryFlockId ?? null,
        category: data.category,
        amount: data.amount,
        description: data.description ?? null,
        spent_on: data.spentOn,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as FarmExpenseRow[];
    if (!row) throw new Error('farm expense insert did not return a row');
    return rowToFarmExpense(row);
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
    if (patch.poultryFlockId !== undefined) dbPatch.poultry_flock_id = patch.poultryFlockId;
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as FarmExpenseRow[];
    if (!row) throw new Error('farm expense not found after update');
    return rowToFarmExpense(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  /**
   * "المصاريف" list: manual `farm_expenses` rows merged with every daily record
   * (poultry / sheep / cattle) that carries an `expense_amount`, newest first.
   * Daily-record lines are read in place — never copied into `farm_expenses` —
   * so each amount exists exactly once. A category filter shows manual rows
   * only (daily records have no category); a flock filter keeps that flock's
   * manual rows + its own daily records.
   */
  async listForOrganization(
    organizationId: string,
    filter: ListFarmExpensesFilter,
  ): Promise<{ items: FarmExpense[]; total: number }> {
    const merged = (): Knex.QueryBuilder => {
      const manual = this.db<FarmExpenseRow>(`${TABLE} as e`)
        .where('e.organization_id', organizationId)
        .select(
          'e.id',
          'e.organization_id',
          'e.poultry_flock_id',
          'e.category',
          'e.amount',
          'e.description',
          'e.spent_on',
          'e.created_by_user_id',
          'e.created_at',
          'e.updated_at',
          this.db.raw(`'MANUAL'::text AS source`),
          this.db.raw('NULL::text AS batch_kind'),
          this.db.raw('NULL::uuid AS batch_id'),
          this.db.raw('NULL::text AS batch_name'),
          this.db.raw('NULL::int AS batch_number'),
        );
      if (filter.category) manual.andWhere('e.category', filter.category);
      if (filter.poultryFlockId) manual.andWhere('e.poultry_flock_id', filter.poultryFlockId);
      if (filter.from) manual.andWhere('e.spent_on', '>=', filter.from);
      if (filter.to) manual.andWhere('e.spent_on', '<=', filter.to);

      const daily = filter.category
        ? []
        : DAILY_EXPENSE_SOURCES.filter(
            (src) => !filter.poultryFlockId || src.kind === 'POULTRY',
          ).map((src) => {
            const qb = this.db(`${src.recordTable} as d`)
              .join(`${src.batchTable} as b`, 'b.id', `d.${src.batchColumn}`)
              .where('d.organization_id', organizationId)
              .andWhere('d.expense_amount', '>', 0)
              .select(
                'd.id',
                'd.organization_id',
                this.db.raw(src.kind === 'POULTRY' ? 'd.poultry_flock_id' : 'NULL::uuid'),
                this.db.raw(`'OTHER'::text`),
                'd.expense_amount',
                this.db.raw('NULL::text'),
                'd.record_date',
                'd.created_by_user_id',
                'd.created_at',
                'd.updated_at',
                this.db.raw(`'DAILY_RECORD'::text`),
                this.db.raw('?::text', [src.kind]),
                'b.id',
                'b.name',
                'b.batch_number',
              );
            if (filter.poultryFlockId) qb.andWhere('d.poultry_flock_id', filter.poultryFlockId);
            if (filter.from) qb.andWhere('d.record_date', '>=', filter.from);
            if (filter.to) qb.andWhere('d.record_date', '<=', filter.to);
            return qb;
          });
      return daily.length ? manual.unionAll(daily, true) : manual;
    };

    const countRow = (await this.db
      .from(merged().as('x'))
      .count<{ count: string }>({ count: '*' })
      .first()) as { count: string } | undefined;
    const total = Number(countRow?.count ?? 0);
    const rows: FarmExpenseRow[] = await this.db
      .from(merged().as('x'))
      .select('*')
      .orderBy([
        { column: 'spent_on', order: 'desc' },
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToFarmExpense), total };
  }

  /**
   * Total spent on the farm's CURRENT operation within `[from, to]` (inclusive
   * dates): manual expenses by `spent_on` + daily-record expenses by
   * `record_date` — the same lines the list shows, each counted once — minus
   * every expense tied to a batch that has been sold / closed. Selling a batch
   * therefore resets the "المصاريف" summary for it without touching a single
   * row: the list, the batch's own summary and every report keep the history,
   * and reopening the batch brings its figures back. Farm-wide manual expenses
   * (no batch) always count.
   */
  async sumCurrentInRange(organizationId: string, from: string, to: string): Promise<number> {
    const manual = this.db(`${TABLE} as e`)
      .leftJoin('poultry_flocks as f', 'f.id', 'e.poultry_flock_id')
      .where('e.organization_id', organizationId)
      .andWhere('e.spent_on', '>=', from)
      .andWhere('e.spent_on', '<=', to)
      .andWhere((q) => {
        void q.whereNull('e.poultry_flock_id').orWhere('f.status', 'ACTIVE');
      })
      .sum<{ total: string | null }>({ total: 'e.amount' })
      .first();
    const daily = DAILY_EXPENSE_SOURCES.map((src) =>
      this.db(`${src.recordTable} as d`)
        .join(`${src.batchTable} as b`, 'b.id', `d.${src.batchColumn}`)
        .where('d.organization_id', organizationId)
        .andWhere('d.record_date', '>=', from)
        .andWhere('d.record_date', '<=', to)
        .andWhere('b.status', 'ACTIVE')
        .sum<{ total: string | null }>({ total: 'd.expense_amount' })
        .first(),
    );
    const rows = (await Promise.all([manual, ...daily])) as (
      { total: string | null } | undefined
    )[];
    return rows.reduce((acc, row) => acc + Number(row?.total ?? 0), 0);
  }

  /** Total expenses attributed to one batch (for the batch-summary profit calc). */
  async sumForFlock(flockId: string): Promise<number> {
    const row = (await this.db(TABLE)
      .where('poultry_flock_id', flockId)
      .sum<{ total: string | null }>({ total: 'amount' })
      .first()) as { total: string | null } | undefined;
    return Number(row?.total ?? 0);
  }
}
