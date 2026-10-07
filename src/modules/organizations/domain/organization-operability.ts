import { computeFarmSubscriptionStatus } from './organization.types.js';

/**
 * Organization types whose operation depends on an admin-controlled
 * subscription period (`*_details.subscription_*_date`). FARM has its own,
 * stricter rule (`requireActiveFarmSubscription`, also blocks NOT_STARTED).
 */
export const SUBSCRIPTION_GATED_ORG_TYPES: ReadonlySet<string> = new Set([
  'VETERINARY_OFFICE',
  'CLINIC',
]);

export type OrganizationOperabilityReason =
  /** Still awaiting admin approval of the registration. */
  | 'PENDING_APPROVAL'
  /** REJECTED / SUSPENDED / DEACTIVATED. */
  | 'NOT_ACTIVE'
  /** Approved, but the subscription period has ended. */
  | 'SUBSCRIPTION_EXPIRED';

export type OrganizationOperability =
  { operational: true } | { operational: false; reason: OrganizationOperabilityReason };

/**
 * THE single answer to "may this organization operate right now?" — used by
 * the HTTP subscription guard, the chat service (incl. realtime room joins)
 * and appointment booking, so every path applies the same rule:
 *
 *   status === 'ACTIVE'
 *   AND (not subscription-gated OR subscription status !== 'EXPIRED')
 *
 * Subscription status is derived exactly as everywhere else
 * (`computeFarmSubscriptionStatus`: no dates → NOT_STARTED; `endDate >= today`
 * → ACTIVE, i.e. the last day is still valid; otherwise EXPIRED). It is never
 * read from a stored status column, so a renewal (new dates) restores access
 * immediately.
 */
export function computeOrganizationOperability(
  org: { type: string; status: string },
  subscription: { startDate: string | null; endDate: string | null } | null,
  now: Date = new Date(),
): OrganizationOperability {
  if (org.status === 'PENDING') return { operational: false, reason: 'PENDING_APPROVAL' };
  if (org.status !== 'ACTIVE') return { operational: false, reason: 'NOT_ACTIVE' };
  if (
    SUBSCRIPTION_GATED_ORG_TYPES.has(org.type) &&
    subscription &&
    computeFarmSubscriptionStatus(subscription.startDate, subscription.endDate, now) === 'EXPIRED'
  ) {
    return { operational: false, reason: 'SUBSCRIPTION_EXPIRED' };
  }
  return { operational: true };
}
