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
  /** Distinct animals with a record or vaccination entered by this clinic today. */
  visitorsToday: number;
}

export interface ClinicAppointmentStats {
  /** Non-rejected / non-cancelled appointments scheduled for today. */
  todayCount: number;
  /** Requests awaiting the clinic's decision (`PENDING`). */
  pendingCount: number;
  /** `CONFIRMED` appointments from now on. */
  upcomingCount: number;
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
 * `CURRENT_DATE`, matching the subscription-date convention.
 */
export class ClinicDashboardRepository {
  constructor(private readonly db: Knex) {}

  async countActiveAnimals(organizationId: string): Promise<number> {
    const row = await this.db('animal_clinic_access')
      .where({ organization_id: organizationId, status: 'ACTIVE' })
      .count<{ count: string }>({ count: '*' })
      .first();
    return toCount(row);
  }

  async medicalStats(organizationId: string): Promise<ClinicMedicalStats> {
    const [records, recordsToday, vaccinations, dueToday, visitors] = await Promise.all([
      this.db('medical_records')
        .where({ organization_id: organizationId })
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db('medical_records')
        .where({ organization_id: organizationId })
        .andWhereRaw('visit_date = CURRENT_DATE')
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db('vaccinations')
        .where({ organization_id: organizationId })
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db('vaccinations')
        .where({ organization_id: organizationId })
        .andWhereRaw('next_due_on = CURRENT_DATE')
        .count<{ count: string }>({ count: '*' })
        .first(),
      this.db
        .from(
          this.db
            .select('animal_id')
            .from('medical_records')
            .where({ organization_id: organizationId })
            .andWhereRaw('visit_date = CURRENT_DATE')
            .union((qb) => {
              void qb
                .select('animal_id')
                .from('vaccinations')
                .where({ organization_id: organizationId })
                .andWhereRaw('administered_on = CURRENT_DATE');
            })
            .as('today_animals'),
        )
        .count<{ count: string }>({ count: '*' })
        .first(),
    ]);
    return {
      medicalRecordsCount: toCount(records),
      medicalRecordsToday: toCount(recordsToday),
      vaccinationsCount: toCount(vaccinations),
      vaccinationsDueToday: toCount(dueToday),
      visitorsToday: toCount(visitors),
    };
  }

  async appointmentStats(organizationId: string): Promise<ClinicAppointmentStats> {
    const [today, pending, upcoming] = await Promise.all([
      this.db('clinic_appointments')
        .where({ organization_id: organizationId })
        .whereNotIn('status', ['REJECTED', 'CANCELLED'])
        .andWhereRaw('scheduled_for::date = CURRENT_DATE')
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
    ]);
    return {
      todayCount: toCount(today),
      pendingCount: toCount(pending),
      upcomingCount: toCount(upcoming),
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
          this.db.raw(
            'min(next_due_on) FILTER (WHERE next_due_on >= CURRENT_DATE)::text as next_due',
          ),
        ),
    ]);
    return {
      medicalRecordsCount: toCount(records),
      vaccinationsCount: toCount(vaccinations),
      lastVisitDate: records?.last_visit ?? null,
      nextVaccinationDue: vaccinations?.next_due ?? null,
    };
  }
}
