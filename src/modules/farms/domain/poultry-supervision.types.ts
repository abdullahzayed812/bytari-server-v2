import type { FarmSubscriptionStatus } from '../../organizations/domain/organization.types.js';

/**
 * Admin "Poultry Supervisors Management" (إدارة مشرفي الدواجن / إدارة ارتباط
 * الأطباء بالحقول) read + write models.
 *
 * A veterinarian is LINKED to a poultry farm when — and only while — they hold
 * an ACTIVE `organization_memberships` row in it (the existing farm ↔ vet
 * relationship; no separate link table) with:
 *  - role VETERINARIAN (farm join code / QR, or the admin link form) or role
 *    SUPERVISOR (a supervisor grant) — the "supervising" roles; OWNER / STAFF
 *    are the farm's own people, not supervisors;
 *  - the member is an APPROVED veterinarian whose account is not deleted
 *    (`users.status <> 'DEACTIVATED'`);
 *  - the farm is a poultry farm (admin species partition) that is not deleted
 *    (`organizations.status <> 'DEACTIVATED'`).
 * LEFT / REMOVED / SUSPENDED memberships are not links. The relationship date
 * is `organization_memberships.assigned_at` (reset on re-join / role change;
 * chosen by the admin on the link form).
 *
 * The admin link form enforces ONE supervising vet per farm ("كل حقل يشرف
 * عليه طبيب بيطري واحد"); the join-code flow predates it and may attach
 * more, so a farm row carries a list (newest assignment first).
 */
export const SUPERVISING_ROLE_KEYS = ['VETERINARIAN', 'SUPERVISOR'] as const;
export type SupervisingRoleKey = (typeof SUPERVISING_ROLE_KEYS)[number];

/** "نوع التعاقد / الإشراف" on the admin link form. */
export const SUPERVISION_TYPES = ['WEEKLY', 'RESIDENT', 'EMERGENCY'] as const;
export type SupervisionType = (typeof SUPERVISION_TYPES)[number];

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
  capacity: number | null;
  productionType: string | null;
  currentBirdCount: number | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  subscriptionStatus: FarmSubscriptionStatus;
  imageUrl: string | null;
  createdAt: string;
}

/** One current vet ↔ farm link (the membership). */
export interface PoultrySupervisionLinkInfo {
  membershipId: string;
  role: SupervisingRoleKey;
  /** When the vet was assigned to the farm in this role. */
  assignedAt: string;
  supervisionType: SupervisionType | null;
  notes: string | null;
}

/** "الحقول المرتبطة" row — a farm and its supervising vet(s), newest assignment first. */
export interface PoultrySupervisionLinkedFarm {
  farm: PoultrySupervisionFarm;
  links: Array<PoultrySupervisionLinkInfo & { veterinarian: PoultrySupervisionVeterinarian }>;
}

/** "الأطباء" row — a veterinarian and the poultry farms they currently supervise. */
export interface PoultrySupervisionVeterinarianRow {
  veterinarian: PoultrySupervisionVeterinarian;
  links: Array<
    PoultrySupervisionLinkInfo & {
      farm: { organizationId: string; name: string; governorate: string | null };
    }
  >;
}

export type VeterinarianLinkState = 'linked' | 'unlinked';

export interface PoultrySupervisionListFilter {
  page: number;
  pageSize: number;
  search?: string;
  /** Farm governorate (farm lists) / vet governorate (vet list). */
  governorate?: string;
}

export interface PoultrySupervisionSummary {
  linkedFarms: number;
  unlinkedFarms: number;
  linkedVeterinarians: number;
  unlinkedVeterinarians: number;
}

export interface CreatePoultrySupervisionLinkInput {
  organizationId: string;
  veterinarianUserId: string;
  supervisionType: SupervisionType;
  /** `YYYY-MM-DD`, not in the future. */
  startDate: string;
  notes?: string | null;
}
