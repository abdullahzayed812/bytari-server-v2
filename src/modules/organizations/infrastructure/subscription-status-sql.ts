import type { Knex } from 'knex';
import type { FarmSubscriptionStatus } from '../domain/organization.types.js';

/** The `*_details` table holding each subscription-capable type's period. */
export const SUBSCRIPTION_DETAILS_TABLE: Record<string, string> = {
  FARM: 'farm_details',
  VETERINARY_OFFICE: 'veterinary_office_details',
  CLINIC: 'clinic_details',
};

/**
 * SQL form of `computeFarmSubscriptionStatus` against a details-table alias,
 * so list filtering / pagination stay correct (shared by the admin farms and
 * admin organizations lists).
 */
export function whereSubscriptionStatus(
  qb: Knex.QueryBuilder,
  alias: string,
  status: FarmSubscriptionStatus,
): void {
  if (status === 'NOT_STARTED') {
    qb.where((b) => {
      b.whereNull(`${alias}.subscription_start_date`).orWhereNull(`${alias}.subscription_end_date`);
    });
  } else if (status === 'ACTIVE') {
    qb.whereNotNull(`${alias}.subscription_end_date`).whereRaw(
      `${alias}.subscription_end_date >= CURRENT_DATE`,
    );
  } else {
    qb.whereNotNull(`${alias}.subscription_end_date`).whereRaw(
      `${alias}.subscription_end_date < CURRENT_DATE`,
    );
  }
}
