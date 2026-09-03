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

  async listForOrganization(
    organizationId: string,
    filter: ListFarmExpensesFilter,
  ): Promise<{ items: FarmExpense[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<FarmExpenseRow>(TABLE).where('organization_id', organizationId);
      if (filter.category) qb.andWhere('category', filter.category);
      if (filter.poultryFlockId) qb.andWhere('poultry_flock_id', filter.poultryFlockId);
      if (filter.from) qb.andWhere('spent_on', '>=', filter.from);
      if (filter.to) qb.andWhere('spent_on', '<=', filter.to);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: FarmExpenseRow[] = await base()
      .orderBy([
        { column: 'spent_on', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToFarmExpense), total };
  }

  /** Sum of `amount` for the organization within `[from, to]` (inclusive dates). */
  async sumInRange(organizationId: string, from: string, to: string): Promise<number> {
    const row = (await this.db(TABLE)
      .where('organization_id', organizationId)
      .andWhere('spent_on', '>=', from)
      .andWhere('spent_on', '<=', to)
      .sum<{ total: string | null }>({ total: 'amount' })
      .first()) as { total: string | null } | undefined;
    return Number(row?.total ?? 0);
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
