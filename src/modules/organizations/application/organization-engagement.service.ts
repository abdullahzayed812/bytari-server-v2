import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type {
  OrganizationEngagementSummary,
  OrganizationReview,
  OrganizationReviewWithAuthor,
} from '../domain/organization.types.js';
import type { OrganizationFollowRepository } from '../infrastructure/organization-follow.repository.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';
import type { OrganizationReviewRepository } from '../infrastructure/organization-review.repository.js';

/**
 * Pet Owner engagement with a public organization profile — "متابعة" (follow)
 * and "التقييمات والإعجابات" (ratings & reviews) on the Clinic Details screen.
 * Deliberately separate from {@link OrganizationService}: this is viewer
 * interaction with an org's public profile, not the org lifecycle itself
 * (same split as `MembershipService` / `OrganizationSupervisorService`).
 *
 * Both follow and review only require the organization to be ACTIVE — the
 * same visibility rule `OrganizationService.getPublicById` already enforces
 * for reading the profile in the first place.
 */
export class OrganizationEngagementService {
  private readonly log: Logger;

  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly follows: OrganizationFollowRepository,
    private readonly reviews: OrganizationReviewRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-engagement-service' });
  }

  private async assertActiveOrganization(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Organization not found');
  }

  async follow(organizationId: string, userId: string): Promise<void> {
    await this.assertActiveOrganization(organizationId);
    await this.follows.follow(organizationId, userId);
  }

  async unfollow(organizationId: string, userId: string): Promise<void> {
    await this.follows.unfollow(organizationId, userId);
  }

  async submitReview(
    organizationId: string,
    userId: string,
    input: { rating: number; comment: string | null },
  ): Promise<OrganizationReview> {
    await this.assertActiveOrganization(organizationId);
    return this.reviews.upsert(organizationId, userId, input);
  }

  async listReviews(
    organizationId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrganizationReviewWithAuthor[]; total: number }> {
    await this.assertActiveOrganization(organizationId);
    return this.reviews.listForOrg(organizationId, page, pageSize);
  }

  /**
   * Viewer-independent rating aggregates for a page of organizations (the
   * discover list's cards) — one batched query, not one per row. Missing
   * entries (no reviews yet) mean `rating: null, reviewsCount: 0`.
   */
  async getRatingsForOrganizations(
    organizationIds: string[],
  ): Promise<Map<string, { rating: number | null; reviewsCount: number }>> {
    const aggregates = await this.reviews.aggregateMany(organizationIds);
    const result = new Map<string, { rating: number | null; reviewsCount: number }>();
    for (const id of organizationIds) {
      const agg = aggregates.get(id);
      result.set(id, { rating: agg?.average ?? null, reviewsCount: agg?.count ?? 0 });
    }
    return result;
  }

  /** Viewer-aware summary — `isFollowing` reflects `viewerUserId`'s own state. */
  async getSummary(
    organizationId: string,
    viewerUserId: string,
  ): Promise<OrganizationEngagementSummary> {
    const [isFollowing, followersCount, aggregate] = await Promise.all([
      this.follows.isFollowing(organizationId, viewerUserId),
      this.follows.count(organizationId),
      this.reviews.aggregate(organizationId),
    ]);
    return {
      isFollowing,
      followersCount,
      rating: aggregate.average,
      reviewsCount: aggregate.count,
    };
  }
}
