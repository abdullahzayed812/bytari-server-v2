import type { FarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';

/**
 * Admin "Poultry Supervisors Management" (إدارة مشرفي الدواجن) read models.
 *
 * A veterinarian is LINKED to a poultry farm when — and only while — they hold
 * an ACTIVE `organization_memberships` row in it (the existing farm ↔ vet
 * relationship; no separate link table) with:
 *  - role VETERINARIAN (attached via the farm join code / QR), or role
 *    SUPERVISOR (a supervisor grant) — the "supervising" roles; OWNER / STAFF
 *    are the farm's own people, not supervisors;
 *  - the member is an APPROVED veterinarian whose account is not deleted
 *    (`users.status <> 'DEACTIVATED'`);
 *  - the farm is a poultry farm (admin species partition) that is not deleted
 *    (`organizations.status <> 'DEACTIVATED'`).
 * LEFT / REMOVED / SUSPENDED memberships are not links. The relationship date
 * is `organization_memberships.assigned_at` (reset on re-join / role change).
 */
export const SUPERVISING_ROLE_KEYS = ['VETERINARIAN', 'SUPERVISOR'] as const;
export type SupervisingRoleKey = (typeof SUPERVISING_ROLE_KEYS)[number];

export interface PoultrySupervisionVeterinarian {
  /** The veterinarian ID (the user id). */
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  whatsapp: string | null;
  governorate: string | null;
  specialization: string | null;
  /** Account status (ACTIVE / SUSPENDED). */
  status: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface PoultrySupervisionFarm {
  organizationId: string;
  name: string;
  /** Organization status (PENDING / ACTIVE / REJECTED / SUSPENDED). */
  status: string;
  governorate: string | null;
  location: string | null;
  address: string | null;
  ownerUserId: string;
  ownerName: string;
  ownerPhone: string | null;
  contactPhone: string | null;
  currentBirdCount: number | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  subscriptionStatus: FarmSubscriptionStatus;
  imageUrl: string | null;
  createdAt: string;
}

export interface PoultrySupervisionLink {
  membershipId: string;
  role: SupervisingRoleKey;
  /** When the veterinarian was assigned to the farm in this role. */
  assignedAt: string;
  veterinarian: PoultrySupervisionVeterinarian;
  farm: PoultrySupervisionFarm;
}

export interface PoultrySupervisionListFilter {
  page: number;
  pageSize: number;
  search?: string;
}

export interface PoultrySupervisionSummary {
  linked: number;
  unlinkedFarms: number;
  unlinkedVeterinarians: number;
}
