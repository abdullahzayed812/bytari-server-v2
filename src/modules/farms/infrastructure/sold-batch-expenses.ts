import type { Knex } from 'knex';

/** Where each batch kind keeps the expenses tied to it. */
const SOLD_BATCH_EXPENSE_SOURCES = {
  POULTRY: {
    batchTable: 'poultry_flocks',
    recordTable: 'poultry_daily_records',
    batchColumn: 'poultry_flock_id',
    /** Only poultry flocks can own manual `farm_expenses` rows. */
    manualExpenses: true,
  },
  SHEEP: {
    batchTable: 'sheep_batches',
    recordTable: 'sheep_daily_records',
    batchColumn: 'sheep_batch_id',
    manualExpenses: false,
  },
  CATTLE: {
    batchTable: 'cattle_batches',
    recordTable: 'cattle_daily_records',
    batchColumn: 'cattle_batch_id',
    manualExpenses: false,
  },
} as const;

export type SoldBatchKind = keyof typeof SOLD_BATCH_EXPENSE_SOURCES;

export interface SoldBatchExpensePurge {
  /** `farm_expenses` rows linked to the batch, deleted outright. */
  manualExpensesDeleted: number;
  /** Daily records whose `expense_amount` was erased (the record itself stays). */
  dailyRecordExpensesCleared: number;
  /** Sum of everything removed, for the audit trail. */
  amountRemoved: number;
}

/**
 * Lock the batch row and return its status as stored right now, so the caller
 * decides "is this PATCH a sale?" against the committed state, not a read
 * taken before the transaction (two racing PATCHes serialise here).
 */
export async function lockBatchStatus(
  trx: Knex.Transaction,
  kind: SoldBatchKind,
  batchId: string,
): Promise<string | null> {
  const row: { status: string } | undefined = await trx<{ id: string; status: string }>(
    SOLD_BATCH_EXPENSE_SOURCES[kind].batchTable,
  )
    .where({ id: batchId })
    .forUpdate()
    .first('status');
  return row?.status ?? null;
}

/**
 * A successful sale (ACTIVE → CLOSED) permanently removes every expense tied
 * to the sold batch, inside the sale's own transaction — if the sale rolls
 * back, so does this. Removed:
 *   - manual `farm_expenses` rows with `poultry_flock_id = batch` (DELETE);
 *   - the `expense_amount` of the batch's daily records. A daily record also
 *     holds mortality / feed / weight history (the remaining-birds figure is
 *     derived from it), so the record stays and only its expense is erased.
 * Farm-wide expenses (no batch) and other batches' expenses are untouched.
 * Reopening the batch does not bring anything back.
 */
export async function deleteSoldBatchExpenses(
  trx: Knex.Transaction,
  kind: SoldBatchKind,
  batchId: string,
): Promise<SoldBatchExpensePurge> {
  const src = SOLD_BATCH_EXPENSE_SOURCES[kind];

  let manualExpensesDeleted = 0;
  let amountRemoved = 0;
  if (src.manualExpenses) {
    const deleted: { amount: string }[] = await trx<{ poultry_flock_id: string; amount: string }>(
      'farm_expenses',
    )
      .where({ poultry_flock_id: batchId })
      .del()
      .returning('amount');
    manualExpensesDeleted = deleted.length;
    amountRemoved += deleted.reduce((acc, row) => acc + Number(row.amount), 0);
  }

  // The caller holds the batch row lock (`lockBatchStatus`), and adding a
  // daily record takes the same lock, so nothing slips in between these two.
  const withExpense = (): Knex.QueryBuilder =>
    trx(src.recordTable).where(src.batchColumn, batchId).andWhere('expense_amount', '>', 0);
  const daily = (await withExpense()
    .sum<{ total: string | null }>({ total: 'expense_amount' })
    .first()) as { total: string | null } | undefined;
  amountRemoved += Number(daily?.total ?? 0);
  // `expense_amount` is NOT NULL; 0 is its "no expense" value, which every
  // expense list and total already skips.
  const dailyRecordExpensesCleared = await withExpense().update({
    expense_amount: 0,
    updated_at: new Date(),
  });

  return {
    manualExpensesDeleted,
    dailyRecordExpensesCleared,
    amountRemoved: Math.round(amountRemoved * 100) / 100,
  };
}
