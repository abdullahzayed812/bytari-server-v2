import type { Knex } from 'knex';

/** Organization types whose `*_details` row carries a subscription window. */
const SUBSCRIPTION_DETAIL_TABLES = {
  FARM: 'farm_details',
  VETERINARY_OFFICE: 'veterinary_office_details',
  CLINIC: 'clinic_details',
} as const;
export type SubscriptionOrgType = keyof typeof SUBSCRIPTION_DETAIL_TABLES;

export interface SubscriptionWindowRow {
  organizationId: string;
  organizationType: SubscriptionOrgType;
  ownerUserId: string;
  /** `YYYY-MM-DD`. */
  endDate: string;
}

/** One SCHEDULED vaccination whose `next_due_on` falls in the reminder window. */
export interface DueVaccinationRow {
  vaccinationId: string;
  animalId: string;
  /** The recording clinic (or the clinic it was detached from) — for the copy only. */
  organizationId: string | null;
  ownerUserId: string;
  /** `YYYY-MM-DD`. */
  nextDueOn: string;
}

/** `sourceEventKey` of the automatic due reminder — one per vaccination per due date. */
export function vaccinationDueSourceKey(vaccinationId: string, nextDueOn: string): string {
  return `vaccination.due:${vaccinationId}:${nextDueOn}`;
}

/**
 * Read-only recipient lookups the {@link NotificationPolicy} needs that no
 * domain repository exposes (ADMIN holders, course registrants) plus the
 * subscription-window scan used by the expiry sweep. Every query is capped by
 * the caller-supplied `limit`.
 */
export class NotificationRecipientRepository {
  constructor(private readonly db: Knex) {}

  /** A FARM's `farm_species` (POULTRY / SHEEP / CATTLE / MIXED), `null` when unset — deep-link hint only. */
  async farmSpecies(organizationId: string): Promise<string | null> {
    const row = await this.db('farm_details')
      .where({ organization_id: organizationId })
      .first<{ farm_species: string | null } | undefined>('farm_species');
    return row?.farm_species ?? null;
  }

  /** ACTIVE users holding the global ADMIN role. */
  async activeAdminUserIds(limit: number): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .join('users as u', 'u.id', 'ur.user_id')
      .where('r.key', 'ADMIN')
      .andWhere('u.status', 'ACTIVE')
      .distinct('u.id as id')
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /**
   * Display labels for an owner pet-care notification: the pet's name and the
   * clinic's name only — never any medical content (push previews are public).
   */
  async petCareLabels(
    animalId: string,
    organizationId: string,
  ): Promise<{ petName: string | null; clinicName: string | null }> {
    const [animal, org] = await Promise.all([
      animalId
        ? this.db('animals')
            .where({ id: animalId })
            .first<{ name: string | null } | undefined>('name')
        : undefined,
      organizationId
        ? this.db('organizations')
            .where({ id: organizationId })
            .first<{ name: string | null } | undefined>('name')
        : undefined,
    ]);
    return { petName: animal?.name ?? null, clinicName: org?.name ?? null };
  }

  /**
   * A clinic's "visitors" (legacy `sendMessageToVisitors`): the CURRENT owners
   * of every animal the clinic has its own medical record / vaccination /
   * reminder for (the clinic's worked-with pets), plus pet owners who booked
   * an appointment with it. ACTIVE users only.
   */
  async clinicVisitorUserIds(organizationId: string, limit: number): Promise<string[]> {
    const animalIds = this.db
      .select('animal_id')
      .from('medical_records')
      .where({ organization_id: organizationId })
      .union((qb) => {
        void qb.select('animal_id').from('vaccinations').where({ organization_id: organizationId });
      })
      .union((qb) => {
        void qb
          .select('animal_id')
          .from('animal_reminders')
          .where({ organization_id: organizationId });
      });
    const owners = this.db
      .select('ow.owner_user_id as user_id')
      .from('animal_ownerships as ow')
      .whereNull('ow.ended_at')
      .whereIn('ow.animal_id', animalIds)
      .union((qb) => {
        void qb
          .select('pet_owner_user_id as user_id')
          .from('clinic_appointments')
          .where({ organization_id: organizationId });
      });
    const rows: Array<{ id: string }> = await this.db
      .from(owners.as('v'))
      .join('users as u', 'u.id', 'v.user_id')
      .where('u.status', 'ACTIVE')
      .distinct('u.id as id')
      .limit(limit);
    return rows.map((r) => r.id);
  }

  async courseRegistrantUserIds(courseId: string, limit: number): Promise<string[]> {
    const rows: Array<{ registrant_user_id: string }> = await this.db('vet_course_registrations')
      .where({ course_id: courseId })
      .select('registrant_user_id')
      .limit(limit);
    return rows.map((r) => r.registrant_user_id);
  }

  /**
   * ACTIVE organizations whose subscription `end_date` falls in
   * `[fromDate, toDate]` (inclusive, `YYYY-MM-DD`).
   */
  async subscriptionsEndingBetween(
    fromDate: string,
    toDate: string,
    limit: number,
  ): Promise<SubscriptionWindowRow[]> {
    const out: SubscriptionWindowRow[] = [];
    for (const [type, table] of Object.entries(SUBSCRIPTION_DETAIL_TABLES)) {
      const rows: Array<{ id: string; owner_user_id: string; end_date: string }> = await this.db(
        'organizations as o',
      )
        .join(`${table} as d`, 'd.organization_id', 'o.id')
        .where('o.type', type)
        .andWhere('o.status', 'ACTIVE')
        .whereNotNull('d.subscription_end_date')
        .whereBetween('d.subscription_end_date', [fromDate, toDate])
        .select(
          'o.id',
          'o.owner_user_id',
          this.db.raw(`to_char(d.subscription_end_date, 'YYYY-MM-DD') as end_date`),
        )
        .limit(limit);
      for (const r of rows) {
        out.push({
          organizationId: r.id,
          organizationType: type as SubscriptionOrgType,
          ownerUserId: r.owner_user_id,
          endDate: r.end_date,
        });
      }
    }
    return out;
  }

  /**
   * SCHEDULED vaccinations due in `[fromDate, toDate]` (inclusive) whose pet
   * has a CURRENT owner with an ACTIVE account and an ACTIVE animal record,
   * and that have NOT been reminded for this exact due date yet (so a batch
   * cap never starves later rows on re-runs). Oldest due date first.
   */
  async vaccinationsDueBetween(
    fromDate: string,
    toDate: string,
    limit: number,
  ): Promise<DueVaccinationRow[]> {
    const rows: Array<{
      id: string;
      animal_id: string;
      organization_id: string | null;
      owner_user_id: string;
      next_due_on: string;
    }> = await this.db('vaccinations as v')
      .join('animals as a', 'a.id', 'v.animal_id')
      .join('animal_ownerships as ow', function () {
        this.on('ow.animal_id', '=', 'v.animal_id').andOnNull('ow.ended_at');
      })
      .join('users as u', 'u.id', 'ow.owner_user_id')
      .where('v.status', 'SCHEDULED')
      .andWhere('a.status', 'ACTIVE')
      .andWhere('u.status', 'ACTIVE')
      .whereNotNull('v.next_due_on')
      .whereBetween('v.next_due_on', [fromDate, toDate])
      .whereNotExists(
        this.db('notifications as n')
          .whereRaw('n.recipient_user_id = ow.owner_user_id')
          .andWhereRaw(
            "n.source_event_key = 'vaccination.due:' || v.id || ':' || to_char(v.next_due_on, 'YYYY-MM-DD')",
          )
          .select(this.db.raw('1')),
      )
      .orderBy('v.next_due_on', 'asc')
      .orderBy('v.id', 'asc')
      .limit(limit)
      .select(
        'v.id',
        'v.animal_id',
        this.db.raw(
          'COALESCE(v.organization_id, v.removed_from_organization_id) as organization_id',
        ),
        'ow.owner_user_id',
        this.db.raw(`to_char(v.next_due_on, 'YYYY-MM-DD') as next_due_on`),
      );
    return rows.map((r) => ({
      vaccinationId: r.id,
      animalId: r.animal_id,
      organizationId: r.organization_id,
      ownerUserId: r.owner_user_id,
      nextDueOn: r.next_due_on,
    }));
  }
}
