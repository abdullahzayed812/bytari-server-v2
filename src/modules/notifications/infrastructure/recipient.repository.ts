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

/**
 * Read-only recipient lookups the {@link NotificationPolicy} needs that no
 * domain repository exposes (ADMIN holders, course registrants) plus the
 * subscription-window scan used by the expiry sweep. Every query is capped by
 * the caller-supplied `limit`.
 */
export class NotificationRecipientRepository {
  constructor(private readonly db: Knex) {}

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
}
