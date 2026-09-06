import type { Knex } from 'knex';
import {
  type CreateCattleCaseInput,
  type ListCattleCasesFilter,
  type CattleCaseRow,
  type UpdateCattleCaseInput,
} from '../domain/cattle-ops.types.js';

const TABLE = 'cattle_cases';

/** Rows only — the service resolves `image_key` → `imageUrl` (needs `ObjectStorage`). */
export class CattleCaseRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findRowByIdForBatch(
    id: string,
    batchId: string,
    trx?: Knex.Transaction,
  ): Promise<CattleCaseRow | undefined> {
    return this.conn(trx)<CattleCaseRow>(TABLE).where({ id, cattle_batch_id: batchId }).first();
  }

  async nextCaseNumber(batchId: string, trx: Knex.Transaction): Promise<number> {
    const row = (await trx(TABLE)
      .where({ cattle_batch_id: batchId })
      .max<{ max: number | string | null }>({ max: 'case_number' })
      .first()) as { max: number | string | null } | undefined;
    return Number(row?.max ?? 0) + 1;
  }

  async create(
    data: CreateCattleCaseInput & {
      cattleBatchId: string;
      organizationId: string;
      caseNumber: number;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<CattleCaseRow> {
    const [row] = (await trx(TABLE)
      .insert({
        cattle_batch_id: data.cattleBatchId,
        organization_id: data.organizationId,
        organization_type: 'FARM',
        case_number: data.caseNumber,
        animal_tag: data.animalTag ?? null,
        sex: data.sex ?? 'UNKNOWN',
        diagnosis: data.diagnosis ?? null,
        treatment: data.treatment ?? null,
        status: 'UNDER_TREATMENT',
        started_on: data.startedOn,
        next_followup_on: data.nextFollowupOn ?? null,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as CattleCaseRow[];
    if (!row) throw new Error('cattle case insert did not return a row');
    return row;
  }

  async update(
    id: string,
    patch: UpdateCattleCaseInput & { imageKey?: string | null },
    trx: Knex.Transaction,
  ): Promise<CattleCaseRow> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.animalTag !== undefined) dbPatch.animal_tag = patch.animalTag;
    if (patch.sex !== undefined) dbPatch.sex = patch.sex;
    if (patch.diagnosis !== undefined) dbPatch.diagnosis = patch.diagnosis;
    if (patch.treatment !== undefined) dbPatch.treatment = patch.treatment;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.startedOn !== undefined) dbPatch.started_on = patch.startedOn;
    if (patch.nextFollowupOn !== undefined) dbPatch.next_followup_on = patch.nextFollowupOn;
    if (patch.imageKey !== undefined) dbPatch.image_key = patch.imageKey;
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as CattleCaseRow[];
    if (!row) throw new Error('cattle case not found after update');
    return row;
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForBatch(
    batchId: string,
    filter: ListCattleCasesFilter,
  ): Promise<{ rows: CattleCaseRow[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<CattleCaseRow>(TABLE).where('cattle_batch_id', batchId);
      if (filter.status) qb.andWhere('status', filter.status);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: CattleCaseRow[] = await base()
      .orderBy([
        { column: 'case_number', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { rows, total };
  }

  /** Status counts for the "الحالات الفردية" stat chips. */
  async statusCounts(batchId: string): Promise<Record<string, number>> {
    const rows = (await this.db(TABLE)
      .where('cattle_batch_id', batchId)
      .select('status')
      .count<{ status: string; count: string }[]>({ count: '*' })
      .groupBy('status')) as unknown as { status: string; count: string }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }
}
