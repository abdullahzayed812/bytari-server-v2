/**
 * Admin dashboard home — one aggregate, read-only summary over ~20 other
 * modules (category counts, recent audit activity, a cross-cutting pending
 * task list). Nothing here is persisted; every field is computed live from
 * each owning module's existing repository/service on every request.
 */

export const ADMIN_DASHBOARD_CARD_IDS = [
  'poultry',
  'livestock',
  'pets',
  'consultations',
  'inquiries',
  'ads',
  'clinics',
  'offices',
  'vetApprovals',
  'courses',
  'seminars',
  'services',
  'content',
  'syndicate',
  'petOwners',
  'veterinarians',
  'chats',
  'jobs',
  'supervisors',
  'petOwnerStore',
  'veterinarianStore',
  'users',
  'userMessages',
  'broadcasts',
] as const;
export type AdminDashboardCardId = (typeof ADMIN_DASHBOARD_CARD_IDS)[number];

export interface AdminDashboardCard {
  id: AdminDashboardCardId;
  /** New/unseen items since the caller's last visit to this card — the red notification badge. */
  count: number;
  /**
   * How many items in this section are currently active/approved/live (e.g.
   * ACTIVE organizations, APPROVED veterinarians). For sections with no
   * active/inactive lifecycle (chats, broadcasts, moderation queues), this is
   * simply the total item count already available from that section's own
   * listing — never a second bespoke query.
   */
  activeCount: number;
}

export interface AdminActivityItem {
  id: string;
  /** Raw `AuditAction` enum value — the client maps this to a localized sentence. */
  action: string;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export const ADMIN_PENDING_TASK_KINDS = [
  'VET_APPLICATION',
  'ORGANIZATION_APPROVAL',
  'SUBSCRIPTION_RENEWAL',
] as const;
export type AdminPendingTaskKind = (typeof ADMIN_PENDING_TASK_KINDS)[number];

export const ADMIN_PENDING_TASK_PRIORITIES = ['urgent', 'medium', 'low'] as const;
export type AdminPendingTaskPriority = (typeof ADMIN_PENDING_TASK_PRIORITIES)[number];

export interface AdminPendingTask {
  id: string;
  kind: AdminPendingTaskKind;
  /** Id to deep-link to (the vet application id / organization id, in both cases). */
  targetId: string;
  /** Short, server-composed Arabic label including the real applicant/organization name. */
  label: string;
  priority: AdminPendingTaskPriority;
  createdAt: string;
}

export interface AdminDashboardSummary {
  cards: AdminDashboardCard[];
  recentActivity: AdminActivityItem[];
  pendingTasks: AdminPendingTask[];
}
