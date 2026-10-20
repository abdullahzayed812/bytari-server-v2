import type { Knex } from 'knex';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { businessToday } from '../../../shared/time/business-date.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationEngagementService } from '../../organizations/application/organization-engagement.service.js';
import type { OrganizationService } from '../../organizations/application/organization.service.js';
import type { PublicOrganizationDTO } from '../../organizations/domain/organization.types.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import {
  FEATURED_ORGANIZATION_TYPES,
  FEATURED_PUBLIC_LIMIT,
  featuredState,
  isFeaturableOn,
  type AdminFeaturedOrganizationDTO,
  type FeaturedOrganization,
  type FeaturedPlacement,
} from '../domain/featured-organization.types.js';
import type {
  FeaturedOrganizationRepository,
  FeaturedOrganizationWithOrg,
} from '../infrastructure/featured-organization.repository.js';

export interface FeaturedActor {
  actorUserId: string;
  context?: AuditContext;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/**
 * Admin-curated clinics / veterinary offices of the home-page carousel.
 * Entries reference existing organizations only; what the public sees is
 * re-derived on every read (switch + window + the organization's own public
 * visibility), so an expired window, a suspended clinic or a lapsed
 * subscription drop out without any job, and come back the same way.
 */
export class FeaturedOrganizationService {
  constructor(
    private readonly db: Knex,
    private readonly featured: FeaturedOrganizationRepository,
    private readonly organizations: OrganizationRepository,
    private readonly organizationService: OrganizationService,
    private readonly engagement: OrganizationEngagementService,
    private readonly audit: AuditService,
  ) {}

  /** Public carousel for one home page — the same public card DTO + ratings as discovery. */
  async listVisible(
    placement: FeaturedPlacement,
  ): Promise<Array<PublicOrganizationDTO & { rating?: number | null; reviewsCount?: number }>> {
    const ids = await this.featured.listVisibleOrganizationIds(
      placement,
      businessToday(),
      FEATURED_PUBLIC_LIMIT,
    );
    const cards = (
      await Promise.all(
        ids.map((id) =>
          this.organizationService.getPublicById(id).catch((err: unknown) => {
            if (err instanceof NotFoundError) return null; // hidden between the two reads
            throw err;
          }),
        ),
      )
    ).filter((c): c is PublicOrganizationDTO => c !== null);
    const ratings = await this.engagement.getRatingsForOrganizations(cards.map((c) => c.id));
    return cards.map((c) => ({ ...c, ...ratings.get(c.id) }));
  }

  async listForAdmin(filter: {
    placement?: FeaturedPlacement;
  }): Promise<AdminFeaturedOrganizationDTO[]> {
    const today = businessToday();
    return (await this.featured.listForAdmin(filter)).map((r) => this.toAdminDTO(r, today));
  }

  async create(
    input: {
      organizationId: string;
      placement: FeaturedPlacement;
      startsOn: string;
      endsOn: string;
      isEnabled?: boolean;
      sortOrder?: number;
    },
    actor: FeaturedActor,
  ): Promise<AdminFeaturedOrganizationDTO> {
    this.assertWindow(input.startsOn, input.endsOn);
    const org = await this.organizations.findById(input.organizationId);
    if (!org) throw new NotFoundError('Organization not found');
    if (!(FEATURED_ORGANIZATION_TYPES as readonly string[]).includes(org.type)) {
      throw new BadRequestError('Only clinics and veterinary offices can be featured', {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
    }
    if (!isFeaturableOn(input.placement, org.type)) {
      throw new BadRequestError(
        input.placement === 'PET_OWNER_HOME'
          ? 'Only clinics can be featured on the Pet Owner home'
          : 'Only veterinary offices / companies can be featured on the Veterinarian home',
        { code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED },
      );
    }
    if (org.status !== 'ACTIVE') {
      throw new BadRequestError('Only an active organization can be featured', {
        code: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      });
    }

    let created: FeaturedOrganization;
    try {
      created = await this.db.transaction(async (tx) => {
        const row = await this.featured.insert(
          {
            organizationId: org.id,
            placement: input.placement,
            startsOn: input.startsOn,
            endsOn: input.endsOn,
            isEnabled: input.isEnabled ?? true,
            sortOrder: input.sortOrder ?? 0,
            actorUserId: actor.actorUserId,
          },
          tx,
        );
        await this.audit.record(
          {
            action: AuditAction.HOME_FEATURED_ORGANIZATION_ADDED,
            entityType: AuditEntityType.HOME_FEATURED_ORGANIZATION,
            entityId: row.id,
            actorUserId: actor.actorUserId,
            metadata: {
              organizationId: org.id,
              placement: row.placement,
              startsOn: row.startsOn,
              endsOn: row.endsOn,
              isEnabled: row.isEnabled,
            },
            context: actor.context,
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('This organization is already featured on that home page', {
          code: ErrorCode.CONFLICT,
        });
      }
      throw err;
    }
    return this.mustGetAdmin(created.id);
  }

  async update(
    id: string,
    patch: { startsOn?: string; endsOn?: string; isEnabled?: boolean; sortOrder?: number },
    actor: FeaturedActor,
  ): Promise<AdminFeaturedOrganizationDTO> {
    const current = await this.featured.findById(id);
    if (!current) throw new NotFoundError('Featured entry not found');
    this.assertWindow(patch.startsOn ?? current.startsOn, patch.endsOn ?? current.endsOn);
    await this.db.transaction(async (tx) => {
      await this.featured.update(id, { ...patch, actorUserId: actor.actorUserId }, tx);
      await this.audit.record(
        {
          action: AuditAction.HOME_FEATURED_ORGANIZATION_UPDATED,
          entityType: AuditEntityType.HOME_FEATURED_ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId: current.organizationId,
            placement: current.placement,
            ...patch,
          },
          context: actor.context,
        },
        tx,
      );
    });
    return this.mustGetAdmin(id);
  }

  async remove(id: string, actor: FeaturedActor): Promise<void> {
    const current = await this.featured.findById(id);
    if (!current) throw new NotFoundError('Featured entry not found');
    await this.db.transaction(async (tx) => {
      await this.featured.delete(id, tx);
      await this.audit.record(
        {
          action: AuditAction.HOME_FEATURED_ORGANIZATION_REMOVED,
          entityType: AuditEntityType.HOME_FEATURED_ORGANIZATION,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: current.organizationId, placement: current.placement },
          context: actor.context,
        },
        tx,
      );
    });
  }

  private assertWindow(startsOn: string, endsOn: string): void {
    if (endsOn < startsOn) {
      throw new BadRequestError('The end date must be on or after the start date', {
        code: ErrorCode.VALIDATION_ERROR,
      });
    }
  }

  private async mustGetAdmin(id: string): Promise<AdminFeaturedOrganizationDTO> {
    const row = (await this.featured.listForAdmin({})).find((r) => r.id === id);
    if (!row) throw new NotFoundError('Featured entry not found');
    return this.toAdminDTO(row, businessToday());
  }

  private toAdminDTO(r: FeaturedOrganizationWithOrg, today: string): AdminFeaturedOrganizationDTO {
    const {
      organizationName,
      organizationType,
      organizationStatus,
      subscriptionEndDate,
      ...entry
    } = r;
    return {
      ...entry,
      state: featuredState(entry, today),
      organization: {
        id: entry.organizationId,
        name: organizationName,
        type: organizationType,
        status: organizationStatus,
        publiclyVisible:
          isFeaturableOn(entry.placement, organizationType) &&
          organizationStatus === 'ACTIVE' &&
          (subscriptionEndDate === null || subscriptionEndDate >= today),
      },
    };
  }
}
