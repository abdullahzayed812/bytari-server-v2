import { BUSINESS_TIME_ZONE, businessToday } from '../../../shared/time/business-date.js';
import type { Knex } from 'knex';

export interface ClinicMedicalStats {
  /** Medical records this clinic recorded (all time). */
  medicalRecordsCount: number;
  /** Medical records this clinic recorded with `visit_date = today`. */
  medicalRecordsToday: number;
  /** Vaccinations this clinic recorded (all time). */
  vaccinationsCount: number;
  /** This clinic's vaccinations whose `next_due_on` is today. */
  vaccinationsDueToday: number;
  /** Reminders of this clinic (all time) / open ones dated today. */
  remindersCount: number;
  remindersToday: number;
  /** Distinct animals per source (legacy quick-access counters). */
  medicalAnimals: number;
  vaccinationAnimals: number;
  reminderAnimals: number;
  /** Distinct animals across records, vaccinations and reminders. */
  totalDistinctAnimals: number;
  /** Distinct animals with any entry by this clinic today. */
  visitorsToday: number;
}

export interface ClinicAppointmentStats {
  /** Non-rejected / non-cancelled appointments scheduled for today. */
  todayCount: number;
  /** Requests awaiting the clinic's decision (`PENDING`). */
  pendingCount: number;
  /** `CONFIRMED` appointments from now on. */
  upcomingCount: number;
  /** Distinct animals with any appointment at this clinic. */
  appointmentAnimals: number;
}

export interface ClinicAnimalStats {
  medicalRecordsCount: number;
  vaccinationsCount: number;
  /** Latest `visit_date` across the animal's medical records, or `null`. */
  lastVisitDate: string | null;
  /** Earliest `next_due_on` that is today or later, or `null`. */
  nextVaccinationDue: string | null;
}

function toCount(row: { count?: string | number } | undefined): number {
  return Number(row?.count ?? 0);
}

/**
 * Read-only aggregates for the Clinic Dashboard. Every query is scoped by the
 * trusted `organizationId` (or, for {@link animalStats}, by an animal the
 * caller's clinic was already verified to hold ACTIVE access to) — no row is
 * ever selected by a client-supplied filter. "Today" is the database's
 * the business day (`businessToday()`, Asia/Baghdad), like farm daily records.
 */
export class ClinicDashboardRepository {
  constructor(private readonly db: Knex) {}

  async countActiveAnimals(organizationId: string): Promise<number> {
    const row = await this.db('animal_clinic_access as ac')
      .join('animals as a', 'a.id', 'ac.animal_id')
      .where({
        'ac.organization_id': organizationId,
        'ac.status': 'ACTIVE',
        'a.listing_only': false,
      })
      .count<{ count: string }>({ count: '*' })
      .first();
    return toCount(row);
  }

  async medicalStats(organizationId: string): Promise<ClinicMedicalStats> {
    const today = businessToday();
    const org = { organization_id: organizationId };
    type CountRow = { count?: string | number } | undefined;
    const count = (qb: Knex.QueryBuilder): Promise<CountRow> =>
      qb.count<{ count: string }>({ count: '*' }).first() as Promise<CountRow>;
    const distinctAnimals = (table: string): Promise<CountRow> =>
      this.db(table)
        .where(org)
        .countDistinct<{ count: string }>({ count: 'animal_id' })
        .first() as Promise<CountRow>;

    const [
      records,
      recordsToday,
      vaccinations,
      dueToday,
      reminders,
      remindersToday,
      medicalAnimals,
      vaccinationAnimals,
      reminderAnimals,
      allAnimals,
      visitors,
    ] = await Promise.all([
      count(this.db('medical_records').where(org)),
      count(this.db('medical_records').where(org).andWhereRaw('visit_date = ?::date', [today])),
      count(this.db('vaccinations').where(org)),
      count(
        this.db('vaccinations')
          .where(org)
          .andWhere('status', 'SCHEDULED')
          .andWhereRaw('next_due_on = ?::date', [today]),
      ),
      count(this.db('animal_reminders').where(org)),
      count(
        this.db('animal_reminders')
          .where(org)
          .andWhere('is_completed', false)
          .andWhereRaw('reminder_date = ?::date', [today]),
      ),
      distinctAnimals('medical_records'),
      distinctAnimals('vaccinations'),
      distinctAnimals('animal_reminders'),
      // Legacy `totalDistinctAnimals`: union of every source.
      count(
        this.db.from(
          this.db
            .select('animal_id')
            .from('medical_records')
            .where(org)
            .union((qb) => void qb.select('animal_id').from('vaccinations').where(org))
            .union((qb) => void qb.select('animal_id').from('animal_reminders').where(org))
            .as('all_animals'),
        ),
      ),
      // Legacy `todayVisitors`: distinct animals with any entry by this clinic today.
      count(
        this.db.from(
          this.db
            .select('animal_id')
            .from('medical_records')
            .where(org)
            .andWhereRaw('visit_date = ?::date', [today])
            .union(
              (qb) =>
                void qb
                  .select('animal_id')
                  .from('vaccinations')
                  .where(org)
                  .andWhereRaw('administered_on = ?::date', [today]),
            )
            .union(
              (qb) =>
                void qb
                  .select('animal_id')
                  .from('animal_reminders')
                  .where(org)
                  .andWhereRaw(
                    `(created_at AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date = ?::date`,
                    [today],
                  ),
            )
            .as('today_animals'),
        ),
      ),
    ]);
    return {
      medicalRecordsCount: toCount(records),
      medicalRecordsToday: toCount(recordsToday),
      vaccinationsCount: toCount(vaccinations),
      vaccinationsDueToday: toCount(dueToday),
      remindersCount: toCount(reminders),
      remindersToday: toCount(remindersToday),
      medicalAnimals: toCount(medicalAnimals),
      vaccinationAnimals: toCount(vaccinationAnimals),
      reminderAnimals: toCount(reminderAnimals),
      totalDistinctAnimals: toCount(allAnimals),
      visitorsToday: toCount(visitors),
    };
  }

  async appointmentStats(organizationId: string): Promise<ClinicAppointmentStats> {
    const [today, pending, upcoming, animals] = await Promise.all([
      this.db('clinic_appointments')
        .where({ organization_id: organizationId })
        .whereNotIn('status', ['REJECTED', 'CANCELLED'])
        .andWhereRaw(`(scheduled_for AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date = ?::date`, [
          businessToday(),
        ])
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db('clinic_appointments')
        .where({ organization_id: organizationId, status: 'PENDING' })
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db('clinic_appointments')
        .where({ organization_id: organizationId, status: 'CONFIRMED' })
        .andWhere('scheduled_for', '>=', this.db.fn.now())
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db('clinic_appointments')
        .where({ organization_id: organizationId })
        .countDistinct<{ count: string }>({ count: 'animal_id' })
        .first(),
    ]);
    return {
      todayCount: toCount(today),
      pendingCount: toCount(pending),
      upcomingCount: toCount(upcoming),
      appointmentAnimals: toCount(animals),
    };
  }

  /**
   * The animal's full veterinary history summary (every clinic's entries — a
   * clinic with an ACTIVE grant reads the complete history, ARCHITECTURE §11.3).
   */
  async animalStats(animalId: string): Promise<ClinicAnimalStats> {
    const [records, vaccinations] = await Promise.all([
      this.db('medical_records')
        .where({ animal_id: animalId })
        .first<{ count: string; last_visit: string | null }>(
          this.db.raw('count(*) as count'),
          this.db.raw('max(visit_date)::text as last_visit'),
        ),
      this.db('vaccinations')
        .where({ animal_id: animalId })
        .first<{ count: string; next_due: string | null }>(
          this.db.raw('count(*) as count'),
          this.db.raw('min(next_due_on) FILTER (WHERE next_due_on >= ?::date)::text as next_due', [
            businessToday(),
          ]),
        ),
    ]);
    return {
      medicalRecordsCount: toCount(records),
      vaccinationsCount: toCount(vaccinations),
      lastVisitDate: records?.last_visit ?? null,
      nextVaccinationDue: vaccinations?.next_due ?? null,
    };
  }

  /** The animal's CURRENT owner (name + phone) — the caller must already hold an ACTIVE grant. */
  async ownerContact(animalId: string): Promise<ClinicAnimalOwnerContact | null> {
    const row:
      { id: string; first_name: string; last_name: string; phone: string | null } | undefined =
      await this.db('animal_ownerships as ow')
        .join('users as u', 'u.id', 'ow.owner_user_id')
        .where('ow.animal_id', animalId)
        .whereNull('ow.ended_at')
        .first('u.id', 'u.first_name', 'u.last_name', 'u.phone');
    return row
      ? { id: row.id, firstName: row.first_name, lastName: row.last_name, phone: row.phone }
      : null;
  }

  /**
   * Owner-facing "العيادات" tab: every clinic that holds ACTIVE access to the
   * animal or has recorded anything for it, with per-clinic counts.
   */
  async clinicsForAnimal(animalId: string): Promise<OwnerAnimalClinicRow[]> {
    const clinicIds = this.db
      .select('organization_id')
      .from('animal_clinic_access')
      .where({ animal_id: animalId, status: 'ACTIVE' })
      .union(
        (qb) =>
          void qb.select('organization_id').from('medical_records').where({ animal_id: animalId }),
      )
      .union(
        (qb) =>
          void qb.select('organization_id').from('vaccinations').where({ animal_id: animalId }),
      )
      .union(
        (qb) =>
          void qb.select('organization_id').from('animal_reminders').where({ animal_id: animalId }),
      );
    const sub = (table: string): Knex.QueryBuilder =>
      this.db(table).count('*').where('animal_id', animalId).andWhereRaw(`organization_id = o.id`);
    const rows: Array<{
      id: string;
      name: string;
      logo_key: string | null;
      phone: string | null;
      address: string | null;
      granted_at: Date | null;
      records: string;
      vaccinations: string;
      reminders: string;
    }> = await this.db('organizations as o')
      .leftJoin('clinic_details as d', 'd.organization_id', 'o.id')
      .leftJoin('animal_clinic_access as ac', function joinGrant() {
        this.on('ac.organization_id', '=', 'o.id')
          .andOnVal('ac.animal_id', '=', animalId)
          .andOnVal('ac.status', '=', 'ACTIVE');
      })
      .whereIn('o.id', clinicIds)
      .select(
        'o.id',
        'o.name',
        'd.logo_key',
        'd.phone',
        'd.address',
        'ac.created_at as granted_at',
        sub('medical_records').as('records'),
        sub('vaccinations').as('vaccinations'),
        sub('animal_reminders').as('reminders'),
      )
      .orderBy('o.name', 'asc');
    return rows.map((r) => ({
      organizationId: r.id,
      name: r.name,
      logoKey: r.logo_key,
      phone: r.phone,
      address: r.address,
      hasActiveAccess: r.granted_at !== null,
      grantedAt: r.granted_at ? r.granted_at.toISOString() : null,
      medicalRecordsCount: Number(r.records),
      vaccinationsCount: Number(r.vaccinations),
      remindersCount: Number(r.reminders),
    }));
  }
}

export interface ClinicAnimalOwnerContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface OwnerAnimalClinicRow {
  organizationId: string;
  name: string;
  logoKey: string | null;
  phone: string | null;
  address: string | null;
  hasActiveAccess: boolean;
  grantedAt: string | null;
  medicalRecordsCount: number;
  vaccinationsCount: number;
  remindersCount: number;
}
