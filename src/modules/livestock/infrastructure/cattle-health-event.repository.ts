import type { Knex } from 'knex';
import {
  rowToCattleHealthEvent,
  type CreateCattleHealthEventInput,
  type ListCattleHealthEventsFilter,
  type CattleHealthEvent,
  type CattleHealthEventRow,
  type UpdateCattleHealthEventInput,
} from '../domain/cattle-ops.types.js';

const TABLE = 'cattle_health_events';

export class CattleHealthEventRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByIdForBatch(
    id: string,
    batchId: string,
    trx?: Knex.Transaction,
  ): Promise<CattleHealthEvent | null> {
    const row = await this.conn(trx)<CattleHealthEventRow>(TABLE)
      .where({ id, cattle_batch_id: batchId })
      .first();
    return row ? rowToCattleHealthEvent(row) : null;
  }

  async create(
    data: CreateCattleHealthEventInput & {
      cattleBatchId: string;
      organizationId: string;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<CattleHealthEvent> {
    const [row] = (await trx(TABLE)
      .insert({
        cattle_batch_id: data.cattleBatchId,
        organization_id: data.organizationId,
        organization_type: 'FARM',
        kind: data.kind,
        name: data.name,
        medication: data.medication ?? null,
        dose: data.dose ?? null,
        event_date: data.eventDate,
        cases_count: data.casesCount ?? null,
        coverage_count: data.coverageCount ?? null,
        next_due_date: data.nextDueDate ?? null,
        status: data.status ?? 'DONE',
        notes: data.notes ?? null,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as CattleHealthEventRow[];
    if (!row) throw new Error('health event insert did not return a row');
    return rowToCattleHealthEvent(row);
  }

  async update(
    id: string,
    patch: UpdateCattleHealthEventInput,
    trx: Knex.Transaction,
  ): Promise<CattleHealthEvent> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.kind !== undefined) dbPatch.kind = patch.kind;
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.medication !== undefined) dbPatch.medication = patch.medication;
    if (patch.dose !== undefined) dbPatch.dose = patch.dose;
    if (patch.eventDate !== undefined) dbPatch.event_date = patch.eventDate;
    if (patch.casesCount !== undefined) dbPatch.cases_count = patch.casesCount;
    if (patch.coverageCount !== undefined) dbPatch.coverage_count = patch.coverageCount;
    if (patch.nextDueDate !== undefined) dbPatch.next_due_date = patch.nextDueDate;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as CattleHealthEventRow[];
    if (!row) throw new Error('health event not found after update');
    return rowToCattleHealthEvent(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForBatch(
    batchId: string,
    filter: ListCattleHealthEventsFilter,
  ): Promise<{ items: CattleHealthEvent[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<CattleHealthEventRow>(TABLE).where('cattle_batch_id', batchId);
      if (filter.kind) qb.andWhere('kind', filter.kind);
      if (filter.status) qb.andWhere('status', filter.status);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: CattleHealthEventRow[] = await base()
      .orderBy([
        { column: 'event_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToCattleHealthEvent), total };
  }
}
