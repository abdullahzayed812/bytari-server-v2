import { computeFarmSubscriptionStatus } from './organization.types.js';

/**
 * Organization types whose operation depends on an admin-controlled
 * subscription period (`*_details.subscription_*_date`). FARM has its own,
 * stricter rule (`requireActiveFarmSubscription`, also blocks NOT_STARTED) —
 * mirrored below so farm chats follow it too.
 */
export const SUBSCRIPTION_GATED_ORG_TYPES: ReadonlySet<string> = new Set([
  'VETERINARY_OFFICE',
  'CLINIC',
]);

const FARM_ORG_TYPE = 'FARM';

export type OrganizationOperabilityReason =
  /** Still awaiting admin approval of the registration. */
  | 'PENDING_APPROVAL'
  /** REJECTED / SUSPENDED / DEACTIVATED. */
  | 'NOT_ACTIVE'
  /** Approved, but the subscription period has ended. */
  | 'SUBSCRIPTION_EXPIRED'
  /** FARM only: the subscription is not ACTIVE (EXPIRED or NOT_STARTED). */
  | 'FARM_SUBSCRIPTION_NOT_ACTIVE';

export type OrganizationOperability =
  { operational: true } | { operational: false; reason: OrganizationOperabilityReason };

/** Whether `computeOrganizationOperability` needs the subscription dates for this organization. */
export function isSubscriptionDependent(org: { type: string; status: string }): boolean {
  return (
    org.status === 'ACTIVE' &&
    (SUBSCRIPTION_GATED_ORG_TYPES.has(org.type) || org.type === FARM_ORG_TYPE)
  );
}

/**
 * THE single answer to "may this organization operate right now?" — used by
 * the HTTP subscription guard, the chat service (incl. realtime room joins)
 * and appointment booking, so every path applies the same rule:
 *
 *   status === 'ACTIVE'
 *   AND (CLINIC / VETERINARY_OFFICE: subscription status !== 'EXPIRED')
 *   AND (FARM: subscription status === 'ACTIVE')
 *
 * The rule is the same for EVERY member — owner, veterinarians, supervisors
 * and employees all lose operational access together; only the owner may
 * then request the renewal (`FarmSubscriptionPolicy.assertOwner`). A global
 * ADMIN bypasses (`OrganizationOperabilityService.assertOperational`).
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
  if (!subscription) return { operational: true };
  const status = computeFarmSubscriptionStatus(subscription.startDate, subscription.endDate, now);
  if (SUBSCRIPTION_GATED_ORG_TYPES.has(org.type) && status === 'EXPIRED') {
    return { operational: false, reason: 'SUBSCRIPTION_EXPIRED' };
  }
  if (org.type === FARM_ORG_TYPE && status !== 'ACTIVE') {
    return { operational: false, reason: 'FARM_SUBSCRIPTION_NOT_ACTIVE' };
  }
  return { operational: true };
}
