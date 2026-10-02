import {
  computeFarmSubscriptionStatus,
  type FarmSubscriptionStatus,
} from '../../organizations/domain/organization.types.js';
import type { TraderStatus, TraderType } from './trader.constants.js';

/** Default activation period granted on approval when the admin picks no dates. */
export const DEFAULT_TRADER_SUBSCRIPTION_DAYS = 365;

export interface TraderProfile {
  id: string;
  userId: string;
  displayName: string;
  traderType: TraderType;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  bio: string | null;
  termsAcceptedAt: string;
  status: TraderStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** Activation period (YYYY-MM-DD); null = never activated. */
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  /** Derived server-side from the dates vs today — never stored. */
  subscriptionStatus: FarmSubscriptionStatus;
  /** Set when the trader asked for a renewal; cleared when a new period is set. */
  renewalRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TraderProfileRow {
  id: string;
  user_id: string;
  display_name: string;
  trader_type: string;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  bio: string | null;
  terms_accepted_at: Date;
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  subscription_start_date?: string | Date | null;
  subscription_end_date?: string | Date | null;
  renewal_requested_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

function dateOnly(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v.slice(0, 10);
}

export function rowToTraderProfile(row: TraderProfileRow): TraderProfile {
  const subscriptionStartDate = dateOnly(row.subscription_start_date);
  const subscriptionEndDate = dateOnly(row.subscription_end_date);
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    traderType: row.trader_type as TraderType,
    governorate: row.governorate,
    district: row.district,
    phone: row.phone,
    whatsapp: row.whatsapp,
    bio: row.bio,
    termsAcceptedAt: row.terms_accepted_at.toISOString(),
    status: row.status as TraderStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionReason: row.decision_reason,
    subscriptionStartDate,
    subscriptionEndDate,
    subscriptionStatus: computeFarmSubscriptionStatus(subscriptionStartDate, subscriptionEndDate),
    renewalRequestedAt: row.renewal_requested_at ? row.renewal_requested_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface RegisterTraderInput {
  displayName: string;
  traderType: TraderType;
  governorate: string;
  district?: string | null;
  phone: string;
  whatsapp?: string | null;
  bio?: string | null;
}

/** Admin-facing summary row — adds the applicant's name/email for a list view. */
export interface TraderApplicationSummary extends TraderProfile {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}
