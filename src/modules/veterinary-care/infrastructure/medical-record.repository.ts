import type { Knex } from 'knex';
import {
  rowToMedicalRecord,
  type ListMedicalRecordsFilter,
  type MedicalRecord,
  type MedicalRecordRow,
} from '../domain/veterinary-care.types.js';

const TABLE = 'medical_records';

export interface CreateMedicalRecordData {
  animalId: string;
  organizationId: string;
  recordedByUserId: string;
  visitDate: string | null;
  reason: string | null;
  diagnosis: string | null;
  treatment: string | null;
  notes: string | null;
}

export interface UpdateMedicalRecordData {
  visitDate?: string;
  reason?: string | null;
  diagnosis?: string | null;
  treatment?: string | null;
  notes?: string | null;
}

export class MedicalRecordRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<MedicalRecord | null> {
    const row = await this.conn(trx)<MedicalRecordRow>(TABLE).where({ id }).first();
    return row ? rowToMedicalRecord(row) : null;
  }

  /** Look up a record and assert it belongs to this animal (IDOR guard). */
  async findByIdForAnimal(
    id: string,
    animalId: string,
    trx?: Knex.Transaction,
  ): Promise<MedicalRecord | null> {
    const row = await this.conn(trx)<MedicalRecordRow>(TABLE)
      .where({ id, animal_id: animalId })
      .first();
    return row ? rowToMedicalRecord(row) : null;
  }

  async create(data: CreateMedicalRecordData, trx: Knex.Transaction): Promise<MedicalRecord> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        organization_id: data.organizationId,
        recorded_by_user_id: data.recordedByUserId,
        ...(data.visitDate ? { visit_date: data.visitDate } : {}),
        reason: data.reason,
        diagnosis: data.diagnosis,
        treatment: data.treatment,
        notes: data.notes,
      })
      .returning('*')) as MedicalRecordRow[];
    if (!row) throw new Error('medical record insert did not return a row');
    return rowToMedicalRecord(row);
  }

  async update(
    id: string,
    patch: UpdateMedicalRecordData,
    trx: Knex.Transaction,
  ): Promise<MedicalRecord> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.visitDate !== undefined) dbPatch.visit_date = patch.visitDate;
    if (patch.reason !== undefined) dbPatch.reason = patch.reason;
    if (patch.diagnosis !== undefined) dbPatch.diagnosis = patch.diagnosis;
    if (patch.treatment !== undefined) dbPatch.treatment = patch.treatment;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as MedicalRecordRow[];
    if (!row) throw new Error('medical record not found after update');
    return rowToMedicalRecord(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  /** Records for an animal, newest visit first. Optionally scoped to one clinic. */
  async listForAnimal(
    animalId: string,
    filter: ListMedicalRecordsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: MedicalRecord[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<MedicalRecordRow>(TABLE).where('animal_id', animalId);
      if (filter.organizationId) qb.andWhere('organization_id', filter.organizationId);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: MedicalRecordRow[] = await base()
      .orderBy([
        { column: 'visit_date', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToMedicalRecord), total };
  }
}
