import type { OrganizationEngagementService } from '../../organizations/application/organization-engagement.service.js';
import type { VeterinaryOfficeProductRepository } from '../infrastructure/veterinary-office-product.repository.js';

/** The one aggregate the dashboard needs from the Organization Store (kept narrow to avoid a module cycle). */
export interface StoreOrderCounts {
  summaryForOrganization(organizationId: string): Promise<{
    deliveredCount: number;
  }>;
}

export interface VeterinaryOfficeDashboardSummary {
  productsCount: number;
  followersCount: number;
  rating: number | null;
  reviewsCount: number;
  /**
   * Delivered Veterinary Office Store orders ("مبيعات"). The incoming-order
   * counters live on `GET …/store-orders/summary` (`store.order.read`), not
   * here (this summary only needs `product.read`).
   */
  salesCount: number;
}

/** Stats for the Veterinary Office Dashboard home screen — composes existing aggregates, no new tables. */
export class VeterinaryOfficeDashboardService {
  constructor(
    private readonly products: VeterinaryOfficeProductRepository,
    private readonly engagement: OrganizationEngagementService,
    private readonly storeOrders: StoreOrderCounts,
  ) {}

  async getSummary(
    organizationId: string,
    viewerUserId: string,
  ): Promise<VeterinaryOfficeDashboardSummary> {
    const [productsCount, engagementSummary, orders] = await Promise.all([
      this.products.countVisibleForOrganization(organizationId),
      this.engagement.getSummary(organizationId, viewerUserId),
      this.storeOrders.summaryForOrganization(organizationId),
    ]);
    return {
      productsCount,
      followersCount: engagementSummary.followersCount,
      rating: engagementSummary.rating,
      reviewsCount: engagementSummary.reviewsCount,
      salesCount: orders.deliveredCount,
    };
  }
}
