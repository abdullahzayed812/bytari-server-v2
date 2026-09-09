import type { Knex } from 'knex';
import {
  rowToClinicAppointment,
  rowToClinicAppointmentHistoryEntry,
  type ClinicAppointment,
  type ClinicAppointmentEventRow,
  type ClinicAppointmentHistoryEntry,
  type ClinicAppointmentJoins,
  type ClinicAppointmentListFilter,
  type ClinicAppointmentRow,
  type CreateClinicAppointmentInput,
} from '../domain/clinic-appointment.types.js';
import type {
  ClinicAppointmentEventKind,
  ClinicAppointmentActorSide,
} from '../domain/clinic-appointment.constants.js';

const TABLE = 'clinic_appointments';
const EVENTS_TABLE = 'clinic_appointment_events';

interface JoinedRow extends ClinicAppointmentRow {
  a_name: string;
  a_species: string;
  a_breed: string | null;
  o_name: string;
  cd_phone: string | null;
  cd_address: string | null;
}

export interface ClinicAppointmentWithJoins {
  appointment: ClinicAppointment;
  joins: ClinicAppointmentJoins;
}

export interface ClinicAppointmentEventInsert {
  appointmentId: string;
  kind: ClinicAppointmentEventKind;
  actorSide: ClinicAppointmentActorSide;
  actorUserId: string | null;
  fromScheduledFor?: string | null;
  toScheduledFor?: string | null;
  reason?: string | null;
}

export class ClinicAppointmentRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joinedBase(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${TABLE} as ca`)
      .join('animals as a', 'a.id', 'ca.animal_id')
      .join('organizations as o', 'o.id', 'ca.organization_id')
      .leftJoin('clinic_details as cd', 'cd.organization_id', 'ca.organization_id')
      .select(
        'ca.*',
        'a.name as a_name',
        'a.species as a_species',
        'a.breed as a_breed',
        'o.name as o_name',
        'cd.phone as cd_phone',
        'cd.address as cd_address',
      );
  }

  private mapJoined(row: JoinedRow): ClinicAppointmentWithJoins {
    return {
      appointment: rowToClinicAppointment(row),
      joins: {
        animal: {
          id: row.animal_id,
          name: row.a_name,
          species: row.a_species,
          breed: row.a_breed,
        },
        organization: {
          id: row.organization_id,
          name: row.o_name,
          phone: row.cd_phone,
          address: row.cd_address,
        },
      },
    };
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<ClinicAppointment | null> {
    const row = await this.conn(trx)<ClinicAppointmentRow>(TABLE).where({ id }).first();
    return row ? rowToClinicAppointment(row) : null;
  }

  async findWithJoinsById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<ClinicAppointmentWithJoins | null> {
    const row = (await this.joinedBase(trx).where('ca.id', id).first()) as JoinedRow | undefined;
    return row ? this.mapJoined(row) : null;
  }

  async create(
    input: CreateClinicAppointmentInput & {
      organizationId: string;
      petOwnerUserId: string;
      createdByUserId: string;
    },
    trx: Knex.Transaction,
  ): Promise<ClinicAppointment> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: input.organizationId,
        animal_id: input.animalId,
        pet_owner_user_id: input.petOwnerUserId,
        visit_type: input.visitType,
        scheduled_for: input.scheduledFor,
        note: input.note ?? null,
        status: 'PENDING',
        created_by_user_id: input.createdByUserId,
      })
      .returning('*')) as ClinicAppointmentRow[];
    if (!row) throw new Error('clinic appointment insert did not return a row');
    return rowToClinicAppointment(row);
  }

  async update(
    id: string,
    patch: {
      status?: string;
      scheduledFor?: string;
      proposedScheduledFor?: string | null;
      decisionReason?: string | null;
      decidedByUserId?: string | null;
      decidedAt?: Date | null;
    },
    trx: Knex.Transaction,
  ): Promise<ClinicAppointment> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.scheduledFor !== undefined) dbPatch.scheduled_for = patch.scheduledFor;
    if (patch.proposedScheduledFor !== undefined)
      dbPatch.proposed_scheduled_for = patch.proposedScheduledFor;
    if (patch.decisionReason !== undefined) dbPatch.decision_reason = patch.decisionReason;
    if (patch.decidedByUserId !== undefined) dbPatch.decided_by_user_id = patch.decidedByUserId;
    if (patch.decidedAt !== undefined) dbPatch.decided_at = patch.decidedAt;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as ClinicAppointmentRow[];
    if (!row) throw new Error('clinic appointment not found after update');
    return rowToClinicAppointment(row);
  }

  async listForOwner(
    petOwnerUserId: string,
    filter: ClinicAppointmentListFilter,
  ): Promise<{ items: ClinicAppointmentWithJoins[]; total: number }> {
    return this.list((qb) => {
      qb.where('ca.pet_owner_user_id', petOwnerUserId);
    }, filter);
  }

  async listForOrganization(
    organizationId: string,
    filter: ClinicAppointmentListFilter,
  ): Promise<{ items: ClinicAppointmentWithJoins[]; total: number }> {
    return this.list((qb) => {
      qb.where('ca.organization_id', organizationId);
      if (filter.petOwnerUserId) qb.andWhere('ca.pet_owner_user_id', filter.petOwnerUserId);
    }, filter);
  }

  private async list(
    scope: (qb: Knex.QueryBuilder) => void,
    filter: ClinicAppointmentListFilter,
  ): Promise<{ items: ClinicAppointmentWithJoins[]; total: number }> {
    const applyFilters = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      scope(qb);
      if (filter.status) qb.andWhere('ca.status', filter.status);
      if (filter.from) qb.andWhere('ca.scheduled_for', '>=', filter.from);
      return qb;
    };

    const countRow = await applyFilters(this.db(`${TABLE} as ca`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await applyFilters(this.joinedBase())
      .orderBy([
        { column: 'ca.scheduled_for', order: 'desc' },
        { column: 'ca.created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinedRow[];

    return { items: rows.map((r) => this.mapJoined(r)), total };
  }

  async insertEvent(data: ClinicAppointmentEventInsert, trx: Knex.Transaction): Promise<void> {
    await trx(EVENTS_TABLE).insert({
      appointment_id: data.appointmentId,
      kind: data.kind,
      actor_side: data.actorSide,
      actor_user_id: data.actorUserId,
      from_scheduled_for: data.fromScheduledFor ?? null,
      to_scheduled_for: data.toScheduledFor ?? null,
      reason: data.reason ?? null,
    });
  }

  async listEvents(appointmentId: string): Promise<ClinicAppointmentHistoryEntry[]> {
    const rows = await this.db<ClinicAppointmentEventRow>(EVENTS_TABLE)
      .where({ appointment_id: appointmentId })
      .orderBy('created_at', 'asc');
    return rows.map(rowToClinicAppointmentHistoryEntry);
  }
}
