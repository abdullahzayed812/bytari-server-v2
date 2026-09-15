import type { OrganizationEngagementService } from '../../organizations/application/organization-engagement.service.js';
import type { VeterinaryOfficeProductRepository } from '../infrastructure/veterinary-office-product.repository.js';

export interface VeterinaryOfficeDashboardSummary {
  productsCount: number;
  followersCount: number;
  rating: number | null;
  reviewsCount: number;
  /**
   * Always `0` — no orders/checkout system exists for VETERINARY_OFFICE products
   * (catalog-only: browse + contact the office, same as Veterinary Store). Shown
   * because the reference screenshots show the stat, not because it is computed
   * from real sales data. Flip this to a real query if/when an orders system for
   * office products is built — do not silently start faking a non-zero value.
   */
  salesCount: number;
}

/** Stats for the Veterinary Office Dashboard home screen — composes existing aggregates, no new tables. */
export class VeterinaryOfficeDashboardService {
  constructor(
    private readonly products: VeterinaryOfficeProductRepository,
    private readonly engagement: OrganizationEngagementService,
  ) {}

  async getSummary(organizationId: string, viewerUserId: string): Promise<VeterinaryOfficeDashboardSummary> {
    const [productsCount, engagementSummary] = await Promise.all([
      this.products.countVisibleForOrganization(organizationId),
      this.engagement.getSummary(organizationId, viewerUserId),
    ]);
    return {
      productsCount,
      followersCount: engagementSummary.followersCount,
      rating: engagementSummary.rating,
      reviewsCount: engagementSummary.reviewsCount,
      salesCount: 0,
    };
  }
}
