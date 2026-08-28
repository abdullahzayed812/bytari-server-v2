export const ORGANIZATION_TYPES = [
  'CLINIC',
  'FARM',
  'VETERINARY_OFFICE',
  'VETERINARY_STORE',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_STATUSES = [
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
  'DEACTIVATED',
] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED', 'LEFT'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface Organization {
  id: string;
  type: OrganizationType;
  name: string;
  description: string | null;
  ownerUserId: string;
  status: OrganizationStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDetails {
  /** FARM only. */
  joinCode?: string;
}

export interface OrganizationWithDetails extends Organization {
  details: OrganizationDetails;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  roleKey: string;
  status: MembershipStatus;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMembershipSummary extends OrganizationMembership {
  user: { id: string; email: string; firstName: string; lastName: string };
}

export interface SupervisorMembershipSummary extends OrganizationMembershipSummary {
  permissions: string[];
}

export interface OrganizationRow {
  id: string;
  type: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationMembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  organization_role_id: string;
  status: string;
  added_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    type: row.type as OrganizationType,
    name: row.name,
    description: row.description,
    ownerUserId: row.owner_user_id,
    status: row.status as OrganizationStatus,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionReason: row.decision_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
