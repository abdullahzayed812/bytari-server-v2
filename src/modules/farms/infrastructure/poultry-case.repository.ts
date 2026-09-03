import type { Knex } from 'knex';
import {
  type CreatePoultryCaseInput,
  type ListPoultryCasesFilter,
  type PoultryCaseRow,
  type UpdatePoultryCaseInput,
} from '../domain/poultry-ops.types.js';

const TABLE = 'poultry_cases';

/**
 * Rows only — the service resolves `image_key` → `imageUrl` (needs
 * `ObjectStorage`) and maps to the DTO, same split the `content` module uses.
 */
export class PoultryCaseRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findRowByIdForFlock(
    id: string,
    flockId: string,
    trx?: Knex.Transaction,
  ): Promise<PoultryCaseRow | undefined> {
    return this.conn(trx)<PoultryCaseRow>(TABLE).where({ id, poultry_flock_id: flockId }).first();
  }

  async nextCaseNumber(flockId: string, trx: Knex.Transaction): Promise<number> {
    const row = (await trx(TABLE)
      .where({ poultry_flock_id: flockId })
      .max<{ max: number | string | null }>({ max: 'case_number' })
      .first()) as { max: number | string | null } | undefined;
    return Number(row?.max ?? 0) + 1;
  }

  async create(
    data: CreatePoultryCaseInput & {
      poultryFlockId: string;
      organizationId: string;
      caseNumber: number;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<PoultryCaseRow> {
    const [row] = (await trx(TABLE)
      .insert({
        poultry_flock_id: data.poultryFlockId,
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
      .returning('*')) as PoultryCaseRow[];
    if (!row) throw new Error('poultry case insert did not return a row');
    return row;
  }

  async update(
    id: string,
    patch: UpdatePoultryCaseInput & { imageKey?: string | null },
    trx: Knex.Transaction,
  ): Promise<PoultryCaseRow> {
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
      .returning('*')) as PoultryCaseRow[];
    if (!row) throw new Error('poultry case not found after update');
    return row;
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForFlock(
    flockId: string,
    filter: ListPoultryCasesFilter,
  ): Promise<{ rows: PoultryCaseRow[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<PoultryCaseRow>(TABLE).where('poultry_flock_id', flockId);
      if (filter.status) qb.andWhere('status', filter.status);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: PoultryCaseRow[] = await base()
      .orderBy([
        { column: 'case_number', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { rows, total };
  }

  /** Status counts for the "الحالات الفردية" stat chips. */
  async statusCounts(flockId: string): Promise<Record<string, number>> {
    const rows = (await this.db(TABLE)
      .where('poultry_flock_id', flockId)
      .select('status')
      .count<{ status: string; count: string }[]>({ count: '*' })
      .groupBy('status')) as unknown as { status: string; count: string }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }
}
