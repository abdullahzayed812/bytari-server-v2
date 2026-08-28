import type { Knex } from 'knex';
import {
  rowToVaccination,
  type ListVaccinationsFilter,
  type Vaccination,
  type VaccinationRow,
} from '../domain/veterinary-care.types.js';

const TABLE = 'vaccinations';

export interface CreateVaccinationData {
  animalId: string;
  organizationId: string;
  recordedByUserId: string;
  vaccineName: string;
  administeredOn: string;
  nextDueOn: string | null;
  notes: string | null;
}

export interface UpdateVaccinationData {
  vaccineName?: string;
  administeredOn?: string;
  nextDueOn?: string | null;
  notes?: string | null;
}

export class VaccinationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Vaccination | null> {
    const row = await this.conn(trx)<VaccinationRow>(TABLE).where({ id }).first();
    return row ? rowToVaccination(row) : null;
  }

  async findByIdForAnimal(
    id: string,
    animalId: string,
    trx?: Knex.Transaction,
  ): Promise<Vaccination | null> {
    const row = await this.conn(trx)<VaccinationRow>(TABLE)
      .where({ id, animal_id: animalId })
      .first();
    return row ? rowToVaccination(row) : null;
  }

  async create(data: CreateVaccinationData, trx: Knex.Transaction): Promise<Vaccination> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        organization_id: data.organizationId,
        recorded_by_user_id: data.recordedByUserId,
        vaccine_name: data.vaccineName,
        administered_on: data.administeredOn,
        next_due_on: data.nextDueOn,
        notes: data.notes,
      })
      .returning('*')) as VaccinationRow[];
    if (!row) throw new Error('vaccination insert did not return a row');
    return rowToVaccination(row);
  }

  async update(
    id: string,
    patch: UpdateVaccinationData,
    trx: Knex.Transaction,
  ): Promise<Vaccination> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.vaccineName !== undefined) dbPatch.vaccine_name = patch.vaccineName;
    if (patch.administeredOn !== undefined) dbPatch.administered_on = patch.administeredOn;
    if (patch.nextDueOn !== undefined) dbPatch.next_due_on = patch.nextDueOn;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as VaccinationRow[];
    if (!row) throw new Error('vaccination not found after update');
    return rowToVaccination(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForAnimal(
    animalId: string,
    filter: ListVaccinationsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: Vaccination[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<VaccinationRow>(TABLE).where('animal_id', animalId);
      if (filter.organizationId) qb.andWhere('organization_id', filter.organizationId);
      if (filter.dueFrom) qb.andWhere('next_due_on', '>=', filter.dueFrom);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: VaccinationRow[] = await base()
      .orderBy([
        { column: 'administered_on', order: 'desc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToVaccination), total };
  }
}
