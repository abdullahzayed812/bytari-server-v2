export { FARM_SUBSCRIPTION_STATUSES, computeFarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';
export type { FarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';

export const RENEWAL_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RenewalRequestStatus = (typeof RENEWAL_REQUEST_STATUSES)[number];

/** Internal aggregate — no joined summaries. */
export interface FarmSubscriptionRenewalRequest {
  id: string;
  organizationId: string;
  requestedByUserId: string;
  status: RenewalRequestStatus;
  note: string | null;
  previousSubscriptionEndDate: string | null;
  newSubscriptionStartDate: string | null;
  newSubscriptionEndDate: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRenewalRequestInput {
  note?: string | null;
}

export interface SetSubscriptionInput {
  startDate: string;
  endDate: string;
}

export interface ApproveRenewalInput {
  startDate: string;
  endDate: string;
}

export interface FarmSubscriptionRenewalRequestRow {
  id: string;
  organization_id: string;
  requested_by_user_id: string;
  status: string;
  note: string | null;
  previous_subscription_end_date: string | Date | null;
  new_subscription_start_date: string | Date | null;
  new_subscription_end_date: string | Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(v: string | Date | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10);
}

export function rowToFarmSubscriptionRenewalRequest(
  row: FarmSubscriptionRenewalRequestRow,
): FarmSubscriptionRenewalRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requestedByUserId: row.requested_by_user_id,
    status: row.status as RenewalRequestStatus,
    note: row.note,
    previousSubscriptionEndDate: dateOnly(row.previous_subscription_end_date),
    newSubscriptionStartDate: dateOnly(row.new_subscription_start_date),
    newSubscriptionEndDate: dateOnly(row.new_subscription_end_date),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionReason: row.decision_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListRenewalRequestsFilter {
  page: number;
  pageSize: number;
  status?: RenewalRequestStatus;
}
