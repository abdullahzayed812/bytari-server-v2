import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type {
  OrganizationEngagementSummary,
  OrganizationReview,
  OrganizationReviewWithAuthor,
} from '../domain/organization.types.js';
import type { MembershipRepository } from '../infrastructure/membership.repository.js';
import type { OrganizationFollowRepository } from '../infrastructure/organization-follow.repository.js';
import type { OrganizationLikeRepository } from '../infrastructure/organization-like.repository.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';
import type {
  AdminOrganizationReview,
  OrganizationReviewRepository,
} from '../infrastructure/organization-review.repository.js';

/**
 * Organization types with a public, reviewable / likeable directory profile.
 * A review of a farm / syndicate / chat room is meaningless — rejected 400.
 */
const REVIEWABLE_TYPES: ReadonlySet<string> = new Set([
  'CLINIC',
  'VETERINARY_OFFICE',
  'VETERINARY_STORE',
]);

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
    private readonly likes: OrganizationLikeRepository,
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditService,
    private readonly db: Knex,
  ) {
    this.log = logger.child({ component: 'organization-engagement-service' });
  }

  private async assertActiveOrganization(organizationId: string): Promise<{ type: string }> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Organization not found');
    return org;
  }

  private async assertReviewable(organizationId: string): Promise<void> {
    const org = await this.assertActiveOrganization(organizationId);
    if (!REVIEWABLE_TYPES.has(org.type)) {
      throw new BadRequestError('This organization type cannot be rated or liked');
    }
  }

  async like(organizationId: string, userId: string): Promise<void> {
    await this.assertReviewable(organizationId);
    await this.likes.like(organizationId, userId);
  }

  async unlike(organizationId: string, userId: string): Promise<void> {
    await this.likes.unlike(organizationId, userId);
  }

  async follow(organizationId: string, userId: string): Promise<void> {
    await this.assertActiveOrganization(organizationId);
    await this.follows.follow(organizationId, userId);
  }

  async unfollow(organizationId: string, userId: string): Promise<void> {
    await this.follows.unfollow(organizationId, userId);
  }

  /**
   * One review per (organization, user) — resubmitting UPDATES it (existing
   * rule, enforced by the unique key + upsert). A member of the organization
   * (owner / staff / vet) cannot rate their own organization.
   */
  async submitReview(
    organizationId: string,
    userId: string,
    input: { rating: number; comment: string | null },
  ): Promise<OrganizationReview> {
    await this.assertReviewable(organizationId);
    const membership = await this.memberships.findByUserAndOrg(userId, organizationId);
    if (membership && membership.status === 'ACTIVE') {
      throw new ForbiddenError('You cannot review an organization you belong to');
    }
    return this.reviews.upsert(organizationId, userId, input);
  }

  async getOwnReview(organizationId: string, userId: string): Promise<OrganizationReview | null> {
    await this.assertActiveOrganization(organizationId);
    return this.reviews.findOwn(organizationId, userId);
  }

  async deleteOwnReview(organizationId: string, userId: string): Promise<void> {
    const own = await this.reviews.findOwn(organizationId, userId);
    if (!own) throw new NotFoundError('Review not found');
    await this.reviews.deleteById(own.id);
  }

  // --- admin moderation -----------------------------------------------

  listReviewsForModeration(filter: {
    page: number;
    pageSize: number;
    organizationId?: string;
    organizationType?: string;
    maxRating?: number;
  }): Promise<{ items: AdminOrganizationReview[]; total: number }> {
    return this.reviews.listForModeration(filter);
  }

  /** Remove an inappropriate review. Audited with the removed content for traceability. */
  async deleteReviewAsAdmin(
    reviewId: string,
    actor: { actorUserId: string; context?: AuditContext },
    reason: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const review = await this.reviews.findById(reviewId, tx);
      if (!review) throw new NotFoundError('Review not found');
      await this.reviews.deleteById(reviewId, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_REVIEW_DELETED,
          entityType: AuditEntityType.ORGANIZATION_REVIEW,
          entityId: review.id,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId: review.organizationId,
            authorUserId: review.userId,
            rating: review.rating,
            comment: review.comment,
            reason,
          },
          context: actor.context,
        },
        tx,
      );
    });
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
    const [isFollowing, followersCount, isLiked, likesCount, aggregate, ownReview] =
      await Promise.all([
        this.follows.isFollowing(organizationId, viewerUserId),
        this.follows.count(organizationId),
        this.likes.isLiked(organizationId, viewerUserId),
        this.likes.count(organizationId),
        this.reviews.aggregate(organizationId),
        this.reviews.findOwn(organizationId, viewerUserId),
      ]);
    return {
      isFollowing,
      followersCount,
      isLiked,
      likesCount,
      rating: aggregate.average,
      reviewsCount: aggregate.count,
      myReview: ownReview ? { rating: ownReview.rating, comment: ownReview.comment } : null,
    };
  }
}
