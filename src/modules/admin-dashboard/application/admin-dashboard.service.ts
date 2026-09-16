import type { AuditService } from '../../audit/audit.service.js';
import type { ConversationRepository } from '../../chat/infrastructure/conversation.repository.js';
import type { ThreadRepository } from '../../consultations/infrastructure/thread.repository.js';
import type { OrganizationService } from '../../organizations/application/organization.service.js';
import type { FarmSubscriptionRenewalRepository } from '../../farms/infrastructure/farm-subscription-renewal.repository.js';
import type { AnimalService } from '../../animals/application/animal.service.js';
import type { VeterinarianService } from '../../veterinarians/veterinarian.service.js';
import type { VetServiceListingService, VetServiceRequestService } from '../../vet-services/index.js';
import type { VetJobOfferService, VetJobSeekerProfileService } from '../../vet-jobs/index.js';
import type { VetCourseService } from '../../vet-courses/index.js';
import type { ContentService } from '../../content/application/content.service.js';
import type { AdvertisementService } from '../../advertisements/application/advertisement.service.js';
import type { PetStoreAdminService } from '../../pet-owner-store/application/pet-owner-store-admin.service.js';
import type { VeterinarianStoreAdminService } from '../../veterinarian-store/application/veterinarian-store-admin.service.js';
import type { UserService } from '../../users/user.service.js';
import type { SupervisorService } from '../../supervisors/supervisor.service.js';
import type { AdminDashboardSeenRepository } from '../infrastructure/admin-dashboard-seen.repository.js';
import {
  ADMIN_DASHBOARD_CARD_IDS,
  type AdminActivityItem,
  type AdminDashboardCard,
  type AdminDashboardCardId,
  type AdminDashboardSummary,
  type AdminPendingTask,
  type AdminPendingTaskPriority,
} from '../domain/admin-dashboard.types.js';

/**
 * Window each card's list is fetched at — large enough that "new since last
 * look" is exact for realistic traffic between two dashboard visits, capped
 * so a card that has never been opened doesn't require scanning a whole
 * table. A card with more than this many genuinely new rows just shows
 * `CARD_WINDOW_SIZE` (matches the common "99+" style badge cap pattern).
 */
const CARD_WINDOW_SIZE = 20;
const WINDOW = { page: 1, pageSize: CARD_WINDOW_SIZE } as const;
/** Combined tasks list cap, across all three queues. */
const TASK_LIST_CAP = 20;
const RECENT_ACTIVITY_SIZE = 10;

const HOUR_MS = 60 * 60 * 1000;

function priorityFromAge(createdAt: string): AdminPendingTaskPriority {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs >= 48 * HOUR_MS) return 'urgent';
  if (ageMs >= 24 * HOUR_MS) return 'medium';
  return 'low';
}

/**
 * A card's badge count is "how many of this fetched window's rows are newer
 * than the caller's last-seen cursor for this card" — never the table total
 * (spec §6). No cursor row yet (card never opened) means everything in the
 * window counts, capped at `CARD_WINDOW_SIZE`.
 */
function countNew(items: Array<{ createdAt: string | Date }>, seenAt: Date | undefined): number {
  if (!seenAt) return items.length;
  return items.filter((i) => new Date(i.createdAt) > seenAt).length;
}

export interface AdminDashboardServiceDeps {
  organizations: OrganizationService;
  farmSubscriptionRenewals: FarmSubscriptionRenewalRepository;
  animals: AnimalService;
  veterinarians: VeterinarianService;
  consultations: ThreadRepository;
  inquiries: ThreadRepository;
  supportMessages: ThreadRepository;
  vetServiceListings: VetServiceListingService;
  vetServiceRequests: VetServiceRequestService;
  vetJobOffers: VetJobOfferService;
  vetJobSeekers: VetJobSeekerProfileService;
  vetCourses: VetCourseService;
  content: ContentService;
  advertisements: AdvertisementService;
  petOwnerStore: PetStoreAdminService;
  veterinarianStore: VeterinarianStoreAdminService;
  users: UserService;
  supervisors: SupervisorService;
  conversations: ConversationRepository;
  audit: AuditService;
  seen: AdminDashboardSeenRepository;
}

/**
 * Backs `GET /admin/dashboard/summary` — every count is read live from its
 * owning module's existing list method (called at `CARD_WINDOW_SIZE` and
 * compared against the caller's own `admin_dashboard_card_seen` cursor, see
 * `countNew`) rather than a bespoke `COUNT(*)` per card, so a card's number
 * can never drift from what its own management screen shows and is never a
 * raw total (spec §4-§6). All reads run in parallel.
 *
 * Each card exposes two independent numbers: `count` (the red notification
 * badge — new/unseen items, scoped to `status: 'PENDING'` for the org/farm
 * approval cards so it means "new requests needing approval", and reset to 0
 * by `markCardSeen` once opened) and `activeCount` (the card's main stat —
 * how many items in that section are currently active/approved/live, or the
 * section's total when it has no active/inactive lifecycle; never affected
 * by "seen").
 */
export class AdminDashboardService {
  constructor(private readonly deps: AdminDashboardServiceDeps) {}

  async getSummary(userId: string): Promise<AdminDashboardSummary> {
    const [
      seenMap,
      poultry,
      livestock,
      clinics,
      offices,
      syndicate,
      vetApplicationsPending,
      pets,
      consultations,
      inquiries,
      userMessages,
      ads,
      courses,
      serviceListings,
      serviceRequests,
      contentMagazines,
      contentBooks,
      jobOffers,
      jobSeekers,
      petOwnerStoreProducts,
      veterinarianStoreProducts,
      petOwners,
      veterinarians,
      allUsers,
      supervisors,
      chats,
      broadcasts,
      recentActivityPage,
      organizationsPending,
      renewalsPending,
      poultryActive,
      livestockActive,
      clinicsActive,
      officesActive,
      syndicateActive,
      vetApprovalsActive,
      petOwnersActive,
      veterinariansActive,
      usersActive,
      coursesActive,
      serviceListingsActive,
      serviceRequestsActive,
      contentMagazinesActive,
      contentBooksActive,
      jobOffersActive,
      jobSeekersActive,
      petOwnerStoreProductsActive,
      veterinarianStoreProductsActive,
      consultationsActive,
      inquiriesActive,
      userMessagesActive,
    ] = await Promise.all([
      this.deps.seen.getSeenMap(userId),
      this.deps.farmSubscriptionRenewals.listFarmsForAdmin({
        ...WINDOW,
        speciesGroup: 'POULTRY',
        status: 'PENDING',
      }),
      this.deps.farmSubscriptionRenewals.listFarmsForAdmin({
        ...WINDOW,
        speciesGroup: 'LIVESTOCK',
        status: 'PENDING',
      }),
      this.deps.organizations.listForAdmin({ ...WINDOW, type: 'CLINIC', status: 'PENDING' }),
      this.deps.organizations.listForAdmin({
        ...WINDOW,
        type: 'VETERINARY_OFFICE',
        status: 'PENDING',
      }),
      this.deps.organizations.listForAdmin({ ...WINDOW, type: 'SYNDICATE', status: 'PENDING' }),
      this.deps.veterinarians.listPending(1, CARD_WINDOW_SIZE),
      this.deps.animals.listForAdmin(WINDOW),
      this.deps.consultations.list(WINDOW),
      this.deps.inquiries.list(WINDOW),
      this.deps.supportMessages.list(WINDOW),
      this.deps.advertisements.listAdminCampaigns(WINDOW),
      this.deps.vetCourses.listForModeration(WINDOW),
      this.deps.vetServiceListings.listForModeration(WINDOW),
      this.deps.vetServiceRequests.listForModeration(WINDOW),
      this.deps.content.listAdmin({ ...WINDOW, type: 'MAGAZINE' }),
      this.deps.content.listAdmin({ ...WINDOW, type: 'BOOK' }),
      this.deps.vetJobOffers.listForModeration(WINDOW),
      this.deps.vetJobSeekers.listForModeration(WINDOW),
      this.deps.petOwnerStore.listProducts(WINDOW),
      this.deps.veterinarianStore.listProducts(WINDOW),
      this.deps.users.list({ ...WINDOW, role: 'PET_OWNER' }),
      this.deps.users.list({ ...WINDOW, role: 'VETERINARIAN' }),
      this.deps.users.list(WINDOW),
      this.deps.supervisors.list(WINDOW),
      this.deps.conversations.listAllForAdmin(WINDOW),
      this.deps.audit.list({ ...WINDOW, action: 'ADMIN_NOTIFICATION_SENT' }),
      this.deps.audit.list({ page: 1, pageSize: RECENT_ACTIVITY_SIZE }),
      this.deps.organizations.listPendingForAdmin(1, CARD_WINDOW_SIZE),
      this.deps.farmSubscriptionRenewals.listAllPendingForAdmin({ page: 1, pageSize: CARD_WINDOW_SIZE }),
      this.deps.farmSubscriptionRenewals.listFarmsForAdmin({
        page: 1,
        pageSize: 1,
        speciesGroup: 'POULTRY',
        status: 'ACTIVE',
      }),
      this.deps.farmSubscriptionRenewals.listFarmsForAdmin({
        page: 1,
        pageSize: 1,
        speciesGroup: 'LIVESTOCK',
        status: 'ACTIVE',
      }),
      this.deps.organizations.listForAdmin({ page: 1, pageSize: 1, type: 'CLINIC', status: 'ACTIVE' }),
      this.deps.organizations.listForAdmin({
        page: 1,
        pageSize: 1,
        type: 'VETERINARY_OFFICE',
        status: 'ACTIVE',
      }),
      this.deps.organizations.listForAdmin({ page: 1, pageSize: 1, type: 'SYNDICATE', status: 'ACTIVE' }),
      this.deps.users.list({ page: 1, pageSize: 1, veterinarianStatus: 'APPROVED' }),
      this.deps.users.list({ page: 1, pageSize: 1, role: 'PET_OWNER', status: 'ACTIVE' }),
      this.deps.users.list({ page: 1, pageSize: 1, role: 'VETERINARIAN', status: 'ACTIVE' }),
      this.deps.users.list({ page: 1, pageSize: 1, status: 'ACTIVE' }),
      this.deps.vetCourses.listForModeration({ page: 1, pageSize: 1, status: 'APPROVED' }),
      this.deps.vetServiceListings.listForModeration({ page: 1, pageSize: 1, status: 'APPROVED' }),
      this.deps.vetServiceRequests.listForModeration({ page: 1, pageSize: 1, status: 'APPROVED' }),
      this.deps.content.listAdmin({ page: 1, pageSize: 1, type: 'MAGAZINE', status: 'PUBLISHED' }),
      this.deps.content.listAdmin({ page: 1, pageSize: 1, type: 'BOOK', status: 'PUBLISHED' }),
      this.deps.vetJobOffers.listForModeration({ page: 1, pageSize: 1, status: 'APPROVED' }),
      this.deps.vetJobSeekers.listForModeration({ page: 1, pageSize: 1, status: 'APPROVED' }),
      this.deps.petOwnerStore.listProducts({ page: 1, pageSize: 1, status: 'ACTIVE' }),
      this.deps.veterinarianStore.listProducts({ page: 1, pageSize: 1, status: 'ACTIVE' }),
      this.deps.consultations.list({ page: 1, pageSize: 1, status: 'OPEN' }),
      this.deps.inquiries.list({ page: 1, pageSize: 1, status: 'OPEN' }),
      this.deps.supportMessages.list({ page: 1, pageSize: 1, status: 'OPEN' }),
    ]);

    const since = (id: AdminDashboardCardId) => seenMap.get(id);
    const cards: AdminDashboardCard[] = [
      { id: 'poultry', count: countNew(poultry.items, since('poultry')), activeCount: poultryActive.total },
      {
        id: 'livestock',
        count: countNew(livestock.items, since('livestock')),
        activeCount: livestockActive.total,
      },
      { id: 'pets', count: countNew(pets.items, since('pets')), activeCount: pets.total },
      {
        id: 'consultations',
        count: countNew(consultations.items, since('consultations')),
        activeCount: consultationsActive.total,
      },
      {
        id: 'inquiries',
        count: countNew(inquiries.items, since('inquiries')),
        activeCount: inquiriesActive.total,
      },
      { id: 'ads', count: countNew(ads.items, since('ads')), activeCount: ads.total },
      { id: 'clinics', count: countNew(clinics.items, since('clinics')), activeCount: clinicsActive.total },
      { id: 'offices', count: countNew(offices.items, since('offices')), activeCount: officesActive.total },
      {
        id: 'vetApprovals',
        count: countNew(vetApplicationsPending.items, since('vetApprovals')),
        activeCount: vetApprovalsActive.total,
      },
      {
        id: 'courses',
        count: countNew(courses.items, since('courses')),
        activeCount: coursesActive.total,
      },
      {
        id: 'services',
        count:
          countNew(serviceListings.items, since('services')) +
          countNew(serviceRequests.items, since('services')),
        activeCount: serviceListingsActive.total + serviceRequestsActive.total,
      },
      {
        id: 'content',
        count:
          countNew(contentMagazines.items, since('content')) +
          countNew(contentBooks.items, since('content')),
        activeCount: contentMagazinesActive.total + contentBooksActive.total,
      },
      {
        id: 'syndicate',
        count: countNew(syndicate.items, since('syndicate')),
        activeCount: syndicateActive.total,
      },
      {
        id: 'petOwners',
        count: countNew(petOwners.items, since('petOwners')),
        activeCount: petOwnersActive.total,
      },
      {
        id: 'veterinarians',
        count: countNew(veterinarians.items, since('veterinarians')),
        activeCount: veterinariansActive.total,
      },
      { id: 'chats', count: countNew(chats.items, since('chats')), activeCount: chats.total },
      {
        id: 'jobs',
        count: countNew(jobOffers.items, since('jobs')) + countNew(jobSeekers.items, since('jobs')),
        activeCount: jobOffersActive.total + jobSeekersActive.total,
      },
      {
        id: 'supervisors',
        count: countNew(supervisors.items, since('supervisors')),
        activeCount: supervisors.total,
      },
      {
        id: 'petOwnerStore',
        count: countNew(petOwnerStoreProducts.items, since('petOwnerStore')),
        activeCount: petOwnerStoreProductsActive.total,
      },
      {
        id: 'veterinarianStore',
        count: countNew(veterinarianStoreProducts.items, since('veterinarianStore')),
        activeCount: veterinarianStoreProductsActive.total,
      },
      { id: 'users', count: countNew(allUsers.items, since('users')), activeCount: usersActive.total },
      {
        id: 'userMessages',
        count: countNew(userMessages.items, since('userMessages')),
        activeCount: userMessagesActive.total,
      },
      {
        id: 'broadcasts',
        count: countNew(broadcasts.items, since('broadcasts')),
        activeCount: broadcasts.total,
      },
    ];

    const recentActivity: AdminActivityItem[] = recentActivityPage.items.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorId: entry.actorUserId,
      actorName: entry.actorName,
      entityType: entry.entityType,
      entityId: entry.entityId,
      createdAt: entry.createdAt,
    }));

    const pendingTasks = this.buildPendingTasks(
      vetApplicationsPending,
      organizationsPending,
      renewalsPending,
    );

    return { cards, recentActivity, pendingTasks };
  }

  /** Marks one ManagementScreen box seen-now for this user — its badge resets to 0. */
  async markCardSeen(userId: string, cardId: AdminDashboardCardId): Promise<void> {
    await this.deps.seen.markSeen(userId, cardId);
  }

  private buildPendingTasks(
    vetApplications: { items: Array<{ id: string; createdAt: string; user: { firstName: string; lastName: string } }> },
    organizations: { items: Array<{ id: string; name: string; createdAt: string }> },
    renewals: { items: Array<{ id: string; organizationId: string; organizationName: string; createdAt: string }> },
  ): AdminPendingTask[] {
    const tasks: AdminPendingTask[] = [
      ...vetApplications.items.map((a) => ({
        id: `VET_APPLICATION:${a.id}`,
        kind: 'VET_APPLICATION' as const,
        targetId: a.id,
        label: `مراجعة طلب اعتماد الطبيب ${a.user.firstName} ${a.user.lastName}`.trim(),
        priority: priorityFromAge(a.createdAt),
        createdAt: a.createdAt,
      })),
      ...organizations.items.map((o) => ({
        id: `ORGANIZATION_APPROVAL:${o.id}`,
        kind: 'ORGANIZATION_APPROVAL' as const,
        targetId: o.id,
        label: `مراجعة طلب تسجيل ${o.name}`,
        priority: priorityFromAge(o.createdAt),
        createdAt: o.createdAt,
      })),
      ...renewals.items.map((r) => ({
        id: `SUBSCRIPTION_RENEWAL:${r.id}`,
        kind: 'SUBSCRIPTION_RENEWAL' as const,
        targetId: r.organizationId,
        label: `مراجعة طلب تجديد اشتراك ${r.organizationName}`,
        priority: priorityFromAge(r.createdAt),
        createdAt: r.createdAt,
      })),
    ];

    return tasks
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, TASK_LIST_CAP);
  }
}

export { ADMIN_DASHBOARD_CARD_IDS };
