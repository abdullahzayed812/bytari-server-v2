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

/**
 * Public directory profile — CLINIC / VETERINARY_OFFICE / VETERINARY_STORE
 * only (`OrganizationPolicy.hasProfileFields`). Lives on that type's
 * `*_details` "extension point" table, same as FARM's `join_code`.
 */
export interface OrganizationProfile {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  logoUrl: string | null;
}

export const emptyOrganizationProfile: OrganizationProfile = {
  address: null,
  latitude: null,
  longitude: null,
  phone: null,
  logoUrl: null,
};

export interface OrganizationDetails extends Partial<OrganizationProfile> {
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

/** Row shape shared by `clinic_details` / `veterinary_office_details` / `veterinary_store_details`. */
export interface ProfileDetailRow {
  organization_id: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  logo_key: string | null;
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

/**
 * Discovery view — any authenticated user browsing organizations (e.g. the Pet
 * Owner Home "Available clinics" section), not just members. Deliberately
 * narrower than {@link Organization}: no owner id / decision metadata.
 *
 * `address` / `latitude` / `longitude` / `phone` / `logoUrl` are `null` for
 * FARM (no profile fields) and for CLINIC/OFFICE/STORE organizations that
 * haven't filled them in yet. `distanceKm` is only set when the list was
 * sorted by `nearest`.
 */
export interface PublicOrganizationDTO extends OrganizationProfile {
  id: string;
  type: OrganizationType;
  name: string;
  description: string | null;
  distanceKm: number | null;
  createdAt: string;
}

export function toPublicOrganizationDTO(
  org: Organization,
  profile: OrganizationProfile = emptyOrganizationProfile,
  distanceKm: number | null = null,
): PublicOrganizationDTO {
  return {
    id: org.id,
    type: org.type,
    name: org.name,
    description: org.description,
    // Named fields, not `...profile` — a caller passing a richer object (e.g.
    // one that still carries the raw `logoKey`) must not leak it here.
    address: profile.address,
    latitude: profile.latitude,
    longitude: profile.longitude,
    phone: profile.phone,
    logoUrl: profile.logoUrl,
    distanceKm,
    createdAt: org.createdAt,
  };
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
