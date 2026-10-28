import type { Knex } from 'knex';
import {
  rowToAppointment,
  type CreateAppointmentInput,
  type FarmAppointment,
  type FarmAppointmentRow,
  type ListAppointmentsFilter,
  type UpdateAppointmentInput,
} from '../domain/poultry-ops.types.js';
import { batchLinkPatch } from '../domain/farm-batch-link.js';
import { selectBatchLink } from './farm-batch-link.js';

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
    const conn = this.conn(trx);
    const row = (await selectBatchLink(
      conn as Knex,
      conn(`${TABLE} as a`)
        .where({ 'a.id': id, 'a.organization_id': organizationId })
        .select('a.*'),
      'a',
    ).first()) as FarmAppointmentRow | undefined;
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
        ...batchLinkPatch(data),
        title: data.title,
        description: data.description ?? null,
        category: data.category ?? 'OTHER',
        scheduled_for: data.scheduledFor,
        status: 'UPCOMING',
        assigned_veterinarian_user_id: data.assignedVeterinarianUserId ?? null,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as FarmAppointmentRow[];
    if (!row) throw new Error('appointment insert did not return a row');
    const created = await this.findByIdForOrganization(row.id, row.organization_id, trx);
    if (!created) throw new Error('appointment insert did not return a row');
    return created;
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
    Object.assign(dbPatch, batchLinkPatch(patch));
    if (patch.assignedVeterinarianUserId !== undefined) {
      dbPatch.assigned_veterinarian_user_id = patch.assignedVeterinarianUserId;
    }
    const [row] = await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning(['id', 'organization_id']);
    if (!row) throw new Error('appointment not found after update');
    const updated = await this.findByIdForOrganization(row.id, row.organization_id, trx);
    if (!updated) throw new Error('appointment not found after update');
    return updated;
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  async listForOrganization(
    organizationId: string,
    filter: ListAppointmentsFilter,
  ): Promise<{ items: FarmAppointment[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<FarmAppointmentRow>(`${TABLE} as a`).where(
        'a.organization_id',
        organizationId,
      );
      if (filter.category) qb.andWhere('a.category', filter.category);
      if (filter.status) qb.andWhere('a.status', filter.status);
      if (filter.from) qb.andWhere('a.scheduled_for', '>=', filter.from);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: FarmAppointmentRow[] = await selectBatchLink(this.db, base().select('a.*'), 'a')
      .orderBy([
        { column: 'a.scheduled_for', order: 'asc' },
        { column: 'a.created_at', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToAppointment), total };
  }

  /**
   * UPCOMING appointments scheduled for `date` on ACTIVE farms, keyset-paged
   * by id — the "due today" sweep walks every page, so none is starved.
   */
  async listUpcomingOn(
    date: string,
    afterId: string | null,
    limit: number,
  ): Promise<FarmAppointment[]> {
    const qb = this.db<FarmAppointmentRow>(`${TABLE} as a`)
      .join('organizations as o', 'o.id', 'a.organization_id')
      .where('a.status', 'UPCOMING')
      .where('a.scheduled_for', date)
      .where('o.status', 'ACTIVE')
      .select('a.*')
      .orderBy('a.id', 'asc')
      .limit(limit);
    if (afterId) qb.where('a.id', '>', afterId);
    const rows = (await qb) as FarmAppointmentRow[];
    return rows.map(rowToAppointment);
  }
}
