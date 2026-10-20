import type { HomeSectionPage } from './home-section.constants.js';

/** The two home pages that carry the featured clinics / offices carousel. */
export const FEATURED_PLACEMENTS = [
  'PET_OWNER_HOME',
  'VETERINARIAN_HOME',
] as const satisfies readonly HomeSectionPage[];
export type FeaturedPlacement = (typeof FEATURED_PLACEMENTS)[number];

/** Only these existing organization types can be featured. */
export const FEATURED_ORGANIZATION_TYPES = ['CLINIC', 'VETERINARY_OFFICE'] as const;
export type FeaturedOrganizationType = (typeof FEATURED_ORGANIZATION_TYPES)[number];

/**
 * Which organization type each home page features: the Pet Owner home shows
 * "العيادات المميزة" (clinics), the Veterinarian home "المكاتب والشركات
 * البيطرية المميزة" (veterinary offices / companies). Enforced on create and on
 * every public read, so a page never shows the other audience's organizations.
 */
export const FEATURED_TYPES_BY_PLACEMENT: Record<
  FeaturedPlacement,
  readonly FeaturedOrganizationType[]
> = {
  PET_OWNER_HOME: ['CLINIC'],
  VETERINARIAN_HOME: ['VETERINARY_OFFICE'],
};

export function isFeaturableOn(placement: FeaturedPlacement, organizationType: string): boolean {
  return (FEATURED_TYPES_BY_PLACEMENT[placement] as readonly string[]).includes(organizationType);
}

/** Most entries one page shows at a time (and the cap of the public read). */
export const FEATURED_PUBLIC_LIMIT = 20;

/**
 * Admin-facing state of an entry, derived (never stored) from the switch and
 * the window against the business date:
 *   DISABLED  — switched off;
 *   SCHEDULED — on, window not started yet;
 *   ACTIVE    — on, today inside the window (the last day still counts);
 *   EXPIRED   — on, window over.
 */
export type FeaturedState = 'DISABLED' | 'SCHEDULED' | 'ACTIVE' | 'EXPIRED';

export function featuredState(
  entry: { isEnabled: boolean; startsOn: string; endsOn: string },
  today: string,
): FeaturedState {
  if (!entry.isEnabled) return 'DISABLED';
  if (entry.startsOn > today) return 'SCHEDULED';
  if (entry.endsOn < today) return 'EXPIRED';
  return 'ACTIVE';
}

export interface FeaturedOrganization {
  id: string;
  organizationId: string;
  placement: FeaturedPlacement;
  startsOn: string;
  endsOn: string;
  isEnabled: boolean;
  sortOrder: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeaturedOrganizationRow {
  id: string;
  organization_id: string;
  placement: string;
  starts_on: string;
  ends_on: string;
  is_enabled: boolean;
  sort_order: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToFeaturedOrganization(r: FeaturedOrganizationRow): FeaturedOrganization {
  return {
    id: r.id,
    organizationId: r.organization_id,
    placement: r.placement as FeaturedPlacement,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    isEnabled: r.is_enabled,
    sortOrder: r.sort_order,
    createdByUserId: r.created_by_user_id,
    updatedByUserId: r.updated_by_user_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

/** Admin list row: the entry, its derived state and the organization it points at. */
export interface AdminFeaturedOrganizationDTO extends FeaturedOrganization {
  state: FeaturedState;
  organization: {
    id: string;
    name: string;
    type: string;
    status: string;
    /**
     * `false` while the organization itself is hidden (not ACTIVE / subscription
     * expired) or its type does not belong on this placement (a legacy entry).
     */
    publiclyVisible: boolean;
  };
}
