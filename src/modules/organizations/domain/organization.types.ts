export const ORGANIZATION_TYPES = [
  'CLINIC',
  'FARM',
  'VETERINARY_OFFICE',
  'VETERINARY_STORE',
  'SYNDICATE',
  'CHAT_ROOM',
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
  /** Free-text — no backend country enum; the mobile client offers a picker over a static list. */
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  logoUrl: string | null;
  workingHours: string | null;
  services: string[];
  email: string | null;
  whatsapp: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  /** Resolved gallery photo URLs (R2 keys resolved server-side, same as `logoUrl`). */
  galleryUrls: string[];
}

export const emptyOrganizationProfile: OrganizationProfile = {
  address: null,
  country: null,
  latitude: null,
  longitude: null,
  phone: null,
  logoUrl: null,
  workingHours: null,
  services: [],
  email: null,
  whatsapp: null,
  websiteUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  galleryUrls: [],
};

/** A clinic's ACTIVE veterinarian members — public-safe subset (no email, no role/status). */
export interface PublicVeterinarian {
  id: string;
  firstName: string;
  lastName: string;
}

/** Aggregate engagement stats for one organization's public profile. */
export interface OrganizationEngagementSummary {
  isFollowing: boolean;
  followersCount: number;
  /** Average rating rounded to 1 decimal, `null` when there are no reviews yet. */
  rating: number | null;
  reviewsCount: number;
}

export interface OrganizationReview {
  id: string;
  organizationId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationReviewWithAuthor extends OrganizationReview {
  author: { firstName: string; lastName: string };
}

export interface OrganizationReviewRow {
  id: string;
  organization_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToOrganizationReview(row: OrganizationReviewRow): OrganizationReview {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * An organization's subscription validity — deliberately SEPARATE from
 * `Organization.status` (the approval state). Computed server-side from the
 * stored dates vs. `now()`, never stored itself, so there is nothing to drift
 * out of sync (§`computeFarmSubscriptionStatus`). Originally FARM-only;
 * generalized to VETERINARY_OFFICE / CLINIC (Veterinary Office Dashboard spec
 * §3) — kept its "Farm" name to avoid a risky rename of the working, tested
 * Farm subsystem (`FarmSubscriptionService` etc. are unchanged and reused
 * as-is for the other two types, the same "shared name, several tables"
 * tradeoff already used by `product.*` between Veterinary Store and Office).
 */
export const FARM_SUBSCRIPTION_STATUSES = ['NOT_STARTED', 'ACTIVE', 'EXPIRED'] as const;
export type FarmSubscriptionStatus = (typeof FARM_SUBSCRIPTION_STATUSES)[number];

/**
 * Pure — no I/O, no device-clock trust. `now` defaults to the real clock but
 * is injectable for tests. Both dates are `YYYY-MM-DD` (or `null` before the
 * farm's first subscription period is ever set).
 */
export function computeFarmSubscriptionStatus(
  startDate: string | null,
  endDate: string | null,
  now: Date = new Date(),
): FarmSubscriptionStatus {
  if (!startDate || !endDate) return 'NOT_STARTED';
  const today = now.toISOString().slice(0, 10);
  return endDate >= today ? 'ACTIVE' : 'EXPIRED';
}

export interface OrganizationDetails extends Partial<OrganizationProfile> {
  /** FARM only. */
  joinCode?: string;
  /** FARM / VETERINARY_OFFICE / CLINIC only — subscription period + derived status. */
  subscriptionStartDate?: string | null;
  subscriptionEndDate?: string | null;
  subscriptionStatus?: FarmSubscriptionStatus;
  /**
   * CLINIC / VETERINARY_OFFICE only — owner/admin-facing registration
   * credentials. Deliberately NEVER on {@link OrganizationProfile} /
   * {@link PublicOrganizationDTO}: reviewed by an admin before approval, not
   * shown on the public directory.
   */
  licenseNumber?: string | null;
  /** Resolved license document photo URLs (R2 keys resolved server-side). */
  licenseDocumentUrls?: string[];
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
  working_hours: string | null;
  services: string[] | null;
  email: string | null;
  whatsapp: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  gallery_keys: string[] | null;
  created_at: Date;
  updated_at: Date;
  /** CLINIC / VETERINARY_OFFICE only (not VETERINARY_STORE) — see `20261017010000_org_subscription_generalize`. */
  subscription_start_date?: string | Date | null;
  subscription_end_date?: string | Date | null;
  /** CLINIC / VETERINARY_OFFICE only — see `20261018010000_organization_registration_details`. */
  country?: string | null;
  license_number?: string | null;
  license_document_keys?: string[] | null;
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
  /**
   * Aggregate rating — average rounded to 1 decimal, `null` with no reviews
   * yet. Attached by the controller (a batched lookup across the page, see
   * `OrganizationEngagementService.getRatingsForOrganizations`) — the service
   * layer here stays unaware of reviews, same module split as `getPublicOne`.
   */
  rating: number | null;
  reviewsCount: number;
  createdAt: string;
}

/**
 * `GET /organizations/discover/:id` full response — the base
 * {@link PublicOrganizationDTO} plus the Clinic Details screen's remaining
 * sections: the ACTIVE veterinarian roster (from `organization_memberships`,
 * not a new field on the org itself) and the viewer's engagement summary
 * (follow state / count, rating / review count).
 */
export interface PublicOrganizationDetailDTO extends PublicOrganizationDTO {
  veterinarians: PublicVeterinarian[];
  engagement: OrganizationEngagementSummary;
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
    country: profile.country,
    latitude: profile.latitude,
    longitude: profile.longitude,
    phone: profile.phone,
    logoUrl: profile.logoUrl,
    workingHours: profile.workingHours,
    services: profile.services,
    email: profile.email,
    whatsapp: profile.whatsapp,
    websiteUrl: profile.websiteUrl,
    instagramUrl: profile.instagramUrl,
    facebookUrl: profile.facebookUrl,
    tiktokUrl: profile.tiktokUrl,
    galleryUrls: profile.galleryUrls,
    distanceKm,
    rating: null,
    reviewsCount: 0,
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
