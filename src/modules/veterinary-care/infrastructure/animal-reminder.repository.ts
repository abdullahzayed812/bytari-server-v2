import { businessToday } from '../../../shared/time/business-date.js';
import type { Knex } from 'knex';
import type { ReminderType } from '../domain/veterinary-care.constants.js';
import {
  rowToAnimalReminder,
  type AnimalReminder,
  type AnimalReminderRow,
  type ClinicListAnimalSummary,
  type ClinicListOwnerSummary,
  type ClinicReminderListStatus,
} from '../domain/veterinary-care.types.js';
import {
  CLINIC_LIST_JOIN_COLUMNS,
  joinClinicAnimalAndOwner,
  readClinicListJoin,
  type ClinicListJoinColumns,
} from './clinic-list-joins.js';

const TABLE = 'animal_reminders';

export interface CreateReminderData {
  animalId: string;
  organizationId: string;
  recordedByUserId: string;
  title: string;
  description: string | null;
  reminderDate: string;
  reminderType: ReminderType;
}

export interface UpdateReminderData {
  title?: string;
  description?: string | null;
  reminderDate?: string;
  reminderType?: ReminderType;
  isCompleted?: boolean;
}

export interface ClinicReminderListItem {
  reminder: AnimalReminder;
  animal: ClinicListAnimalSummary;
  owner: ClinicListOwnerSummary | null;
}

/** Legacy `pet_reminders` — clinic-authored follow-up reminders for an animal. */
export class AnimalReminderRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** Look up a reminder and assert it belongs to this animal (IDOR guard). */
  async findByIdForAnimal(
    id: string,
    animalId: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalReminder | null> {
    const row = await this.conn(trx)<AnimalReminderRow>(TABLE)
      .where({ id, animal_id: animalId })
      .first();
    return row ? rowToAnimalReminder(row) : null;
  }

  async create(data: CreateReminderData, trx: Knex.Transaction): Promise<AnimalReminder> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        organization_id: data.organizationId,
        recorded_by_user_id: data.recordedByUserId,
        title: data.title,
        description: data.description,
        reminder_date: data.reminderDate,
        reminder_type: data.reminderType,
      })
      .returning('*')) as AnimalReminderRow[];
    if (!row) throw new Error('reminder insert did not return a row');
    return rowToAnimalReminder(row);
  }

  async update(
    id: string,
    patch: UpdateReminderData,
    trx: Knex.Transaction,
  ): Promise<AnimalReminder> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.reminderDate !== undefined) dbPatch.reminder_date = patch.reminderDate;
    if (patch.reminderType !== undefined) dbPatch.reminder_type = patch.reminderType;
    if (patch.isCompleted !== undefined) {
      dbPatch.is_completed = patch.isCompleted;
      dbPatch.completed_at = patch.isCompleted ? new Date() : null;
    }
    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as AnimalReminderRow[];
    if (!row) throw new Error('reminder not found after update');
    return rowToAnimalReminder(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  /** An animal's reminders, soonest first — one clinic's when `organizationId` is set. */
  async listForAnimal(
    animalId: string,
    filter: { page: number; pageSize: number; organizationId?: string },
  ): Promise<{ items: AnimalReminder[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<AnimalReminderRow>(TABLE).where('animal_id', animalId);
      if (filter.organizationId) void qb.andWhere('organization_id', filter.organizationId);
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const rows: AnimalReminderRow[] = await base()
      .orderBy([
        { column: 'is_completed', order: 'asc' },
        { column: 'reminder_date', order: 'asc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToAnimalReminder), total: Number(countRow?.count ?? 0) };
  }

  /** Clinic-wide list (legacy `getClinicReminders`) — this clinic's own reminders. */
  async listForClinic(
    organizationId: string,
    filter: { page: number; pageSize: number; status: ClinicReminderListStatus },
  ): Promise<{ items: ClinicReminderListItem[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = joinClinicAnimalAndOwner(this.db(`${TABLE} as r`), 'r', organizationId);
      switch (filter.status) {
        case 'ALL':
          break;
        case 'PENDING':
          qb.andWhere('r.is_completed', false);
          break;
        case 'COMPLETED':
          qb.andWhere('r.is_completed', true);
          break;
        case 'OVERDUE':
          qb.andWhere('r.is_completed', false).andWhereRaw('r.reminder_date < ?::date', [
            businessToday(),
          ]);
          break;
        case 'TODAY':
          qb.andWhere('r.is_completed', false).andWhereRaw('r.reminder_date = ?::date', [
            businessToday(),
          ]);
          break;
      }
      return qb;
    };
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const rows: Array<AnimalReminderRow & ClinicListJoinColumns> = await base()
      .select('r.*', ...CLINIC_LIST_JOIN_COLUMNS)
      .orderBy([
        { column: 'r.is_completed', order: 'asc' },
        { column: 'r.reminder_date', order: 'asc' },
        { column: 'r.created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return {
      items: rows.map((row) => ({
        reminder: rowToAnimalReminder(row),
        ...readClinicListJoin(row.animal_id, row),
      })),
      total: Number(countRow?.count ?? 0),
    };
  }

  /** Today's open reminders of a clinic (legacy "send today's reminders"). */
  async openTodayForClinic(
    organizationId: string,
    limit: number,
  ): Promise<Array<{ id: string; animalId: string; ownerUserId: string | null }>> {
    const rows: Array<{ id: string; animal_id: string; u_id: string | null }> =
      await joinClinicAnimalAndOwner(this.db(`${TABLE} as r`), 'r', organizationId)
        .andWhere('r.is_completed', false)
        .andWhereRaw('r.reminder_date = ?::date', [businessToday()])
        .select('r.id', 'r.animal_id', 'u.id as u_id')
        .limit(limit);
    return rows.map((r) => ({ id: r.id, animalId: r.animal_id, ownerUserId: r.u_id }));
  }
}
