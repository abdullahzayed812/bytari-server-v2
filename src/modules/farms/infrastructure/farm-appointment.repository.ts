import type { Knex } from 'knex';
import {
  rowToAppointment,
  type CreateAppointmentInput,
  type FarmAppointment,
  type FarmAppointmentRow,
  type ListAppointmentsFilter,
  type UpdateAppointmentInput,
} from '../domain/poultry-ops.types.js';

const TABLE = 'farm_appointments';

export class FarmAppointmentRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<FarmAppointment | null> {
    const row = await this.conn(trx)<FarmAppointmentRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToAppointment(row) : null;
  }

  async create(
    data: CreateAppointmentInput & { organizationId: string; createdByUserId: string },
    trx: Knex.Transaction,
  ): Promise<FarmAppointment> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'FARM',
        poultry_flock_id: data.poultryFlockId ?? null,
        title: data.title,
        description: data.description ?? null,
        category: data.category ?? 'OTHER',
        scheduled_for: data.scheduledFor,
        status: 'UPCOMING',
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as FarmAppointmentRow[];
    if (!row) throw new Error('appointment insert did not return a row');
    return rowToAppointment(row);
  }

  async update(
    id: string,
    patch: UpdateAppointmentInput,
    trx: Knex.Transaction,
  ): Promise<FarmAppointment> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.scheduledFor !== undefined) dbPatch.scheduled_for = patch.scheduledFor;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.poultryFlockId !== undefined) dbPatch.poultry_flock_id = patch.poultryFlockId;
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as FarmAppointmentRow[];
    if (!row) throw new Error('appointment not found after update');
    return rowToAppointment(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForOrganization(
    organizationId: string,
    filter: ListAppointmentsFilter,
  ): Promise<{ items: FarmAppointment[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<FarmAppointmentRow>(TABLE).where('organization_id', organizationId);
      if (filter.category) qb.andWhere('category', filter.category);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.from) qb.andWhere('scheduled_for', '>=', filter.from);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: FarmAppointmentRow[] = await base()
      .orderBy([
        { column: 'scheduled_for', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToAppointment), total };
  }
}
