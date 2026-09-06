import type { TraderStatus, TraderType } from './trader.constants.js';

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
  created_at: Date;
  updated_at: Date;
}

export function rowToTraderProfile(row: TraderProfileRow): TraderProfile {
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
