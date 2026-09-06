import type { Knex } from 'knex';
import {
  rowToSheepHealthEvent,
  type CreateSheepHealthEventInput,
  type ListSheepHealthEventsFilter,
  type SheepHealthEvent,
  type SheepHealthEventRow,
  type UpdateSheepHealthEventInput,
} from '../domain/sheep-ops.types.js';

const TABLE = 'sheep_health_events';

export class SheepHealthEventRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByIdForBatch(
    id: string,
    batchId: string,
    trx?: Knex.Transaction,
  ): Promise<SheepHealthEvent | null> {
    const row = await this.conn(trx)<SheepHealthEventRow>(TABLE)
      .where({ id, sheep_batch_id: batchId })
      .first();
    return row ? rowToSheepHealthEvent(row) : null;
  }

  async create(
    data: CreateSheepHealthEventInput & {
      sheepBatchId: string;
      organizationId: string;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<SheepHealthEvent> {
    const [row] = (await trx(TABLE)
      .insert({
        sheep_batch_id: data.sheepBatchId,
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
      .returning('*')) as SheepHealthEventRow[];
    if (!row) throw new Error('health event insert did not return a row');
    return rowToSheepHealthEvent(row);
  }

  async update(
    id: string,
    patch: UpdateSheepHealthEventInput,
    trx: Knex.Transaction,
  ): Promise<SheepHealthEvent> {
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
      .returning('*')) as SheepHealthEventRow[];
    if (!row) throw new Error('health event not found after update');
    return rowToSheepHealthEvent(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForBatch(
    batchId: string,
    filter: ListSheepHealthEventsFilter,
  ): Promise<{ items: SheepHealthEvent[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<SheepHealthEventRow>(TABLE).where('sheep_batch_id', batchId);
      if (filter.kind) qb.andWhere('kind', filter.kind);
      if (filter.status) qb.andWhere('status', filter.status);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: SheepHealthEventRow[] = await base()
      .orderBy([
        { column: 'event_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToSheepHealthEvent), total };
  }
}
