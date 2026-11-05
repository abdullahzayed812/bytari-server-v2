import type { Knex } from 'knex';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { BUSINESS_UTC_OFFSET, businessToday } from '../../../shared/time/business-date.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRbacRepository } from '../../organizations/infrastructure/organization-rbac.repository.js';
import type { UserService } from '../../users/user.service.js';
import {
  SUPERVISING_ROLE_KEYS,
  type CreatePoultrySupervisionLinkInput,
  type PoultrySupervisionFarm,
  type PoultrySupervisionLinkedFarm,
  type PoultrySupervisionListFilter,
  type PoultrySupervisionSummary,
  type PoultrySupervisionVeterinarian,
  type PoultrySupervisionVeterinarianRow,
  type SupervisionType,
  type VeterinarianLinkState,
} from '../domain/poultry-supervision.types.js';
import type {
  CurrentLink,
  FarmRecord,
  PoultrySupervisionRepository,
  VeterinarianRecord,
} from '../infrastructure/poultry-supervision.repository.js';

const MEDIA_URL_TTL_SECONDS = 3600;

export interface SupervisionActor {
  actorUserId: string;
  context?: AuditContext;
}

interface LinkDetails {
  veterinarianUserId: string;
  supervisionType: SupervisionType;
  startDate: string;
  notes?: string | null;
}

/**
 * Admin "Poultry Supervisors Management" (ADMIN only — enforced on the
 * route). Reads are views over the existing farm ↔ vet memberships (see
 * `poultry-supervision.types.ts` for the link definition); writes act on the
 * SAME memberships and publish the SAME events as the organization member
 * flows (`organization.member.added` / `.removed`), so the veterinarian is
 * notified and live sockets re-check access exactly as for any member change.
 *
 * Write rules:
 *  - one supervising veterinarian per farm through this form (409
 *    FARM_ALREADY_SUPERVISED — use "change" instead);
 *  - the vet must be an APPROVED veterinarian with an ACTIVE account;
 *  - a vet who already holds another ACTIVE role in that farm (owner / staff)
 *    is refused (409 FARM_MEMBER_HAS_OTHER_ROLE) rather than silently demoted;
 *  - a LEFT / REMOVED membership row is re-activated (unique per farm + user).
 */
export class PoultrySupervisionService {
  constructor(
    private readonly db: Knex,
    private readonly repo: PoultrySupervisionRepository,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly storage: ObjectStorage,
  ) {}

  private async vet(r: VeterinarianRecord): Promise<PoultrySupervisionVeterinarian> {
    const { avatarKey, ...rest } = r;
    return {
      ...rest,
      avatarUrl: await resolveStorageUrlOrNull(this.storage, avatarKey, MEDIA_URL_TTL_SECONDS),
    };
  }

  private async farm(r: FarmRecord): Promise<PoultrySupervisionFarm> {
    const { imageKey, ...rest } = r;
    return {
      ...rest,
      imageUrl: await resolveStorageUrlOrNull(this.storage, imageKey, MEDIA_URL_TTL_SECONDS),
    };
  }

  summary(filter: { governorate?: string } = {}): Promise<PoultrySupervisionSummary> {
    return this.repo.summary(filter);
  }

  async listLinkedFarms(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: PoultrySupervisionLinkedFarm[]; total: number }> {
    const { items, total } = await this.repo.listLinkedFarms(filter);
    return {
      total,
      items: await Promise.all(
        items.map(async (row) => ({
          farm: await this.farm(row.farm),
          links: await Promise.all(
            row.links.map(async ({ farm: _farm, veterinarian, ...link }) => ({
              ...link,
              veterinarian: await this.vet(veterinarian),
            })),
          ),
        })),
      ),
    };
  }

  async listUnlinkedFarms(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: PoultrySupervisionFarm[]; total: number }> {
    const { items, total } = await this.repo.listUnlinkedFarms(filter);
    return { total, items: await Promise.all(items.map((f) => this.farm(f))) };
  }

  async listVeterinarians(
    filter: PoultrySupervisionListFilter & { link?: VeterinarianLinkState },
  ): Promise<{ items: PoultrySupervisionVeterinarianRow[]; total: number }> {
    const { items, total } = await this.repo.listVeterinarians(filter);
    return {
      total,
      items: await Promise.all(
        items.map(async (row) => ({
          veterinarian: await this.vet(row.veterinarian),
          links: row.links.map(({ veterinarian: _v, farm, ...link }) => ({
            ...link,
            farm: {
              organizationId: farm.organizationId,
              name: farm.name,
              governorate: farm.governorate,
            },
          })),
        })),
      ),
    };
  }

  // --- writes -----------------------------------------------------------------

  private assertStartDate(startDate: string): void {
    if (startDate > businessToday()) {
      throw new BadRequestError('The link start date cannot be in the future');
    }
  }

  /** Approved + ACTIVE veterinarian account, else 409 / 404. */
  private async assertLinkableVet(userId: string, trx: Knex.Transaction): Promise<void> {
    const user = await this.users.getById(userId, trx).catch(() => null);
    if (!user) throw new NotFoundError('Veterinarian not found');
    if (user.veterinarianStatus !== 'APPROVED') {
      throw new ConflictError('Only an approved veterinarian can supervise a farm', {
        code: ErrorCode.VETERINARIAN_APPROVAL_REQUIRED,
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ConflictError('The veterinarian account is not active');
    }
  }

  /** Create / re-activate the vet's VETERINARIAN membership in the farm with the form details. */
  private async attach(
    organizationId: string,
    details: LinkDetails,
    actor: SupervisionActor,
    trx: Knex.Transaction,
  ): Promise<string> {
    await this.assertLinkableVet(details.veterinarianUserId, trx);
    const role = await this.orgRbac.findRoleByKey('VETERINARIAN', trx);
    if (!role) throw new InternalError('Seed data missing: organization role "VETERINARIAN"');

    const existing = await this.memberships.findByUserAndOrg(
      details.veterinarianUserId,
      organizationId,
      trx,
    );
    let membershipId: string;
    if (existing && existing.status === 'ACTIVE') {
      // A supervising role would already have made the farm "linked" (caught
      // by the one-vet rule); anything else is the farm's own owner / staff.
      throw new ConflictError('This veterinarian already holds another role in this farm', {
        code: ErrorCode.FARM_MEMBER_HAS_OTHER_ROLE,
      });
    } else if (existing) {
      membershipId = (
        await this.memberships.update(
          existing.id,
          { organizationRoleId: role.id, status: 'ACTIVE', addedBy: actor.actorUserId },
          trx,
        )
      ).id;
      await this.orgRbac.clearSupervisorPermissions(existing.id, trx);
    } else {
      membershipId = (
        await this.memberships.create(
          {
            organizationId,
            userId: details.veterinarianUserId,
            organizationRoleId: role.id,
            status: 'ACTIVE',
            addedBy: actor.actorUserId,
          },
          trx,
        )
      ).id;
    }
    await this.repo.setLinkDetails(
      membershipId,
      {
        assignedAt: `${details.startDate}T00:00:00${BUSINESS_UTC_OFFSET}`,
        supervisionType: details.supervisionType,
        notes: details.notes?.trim() || null,
      },
      trx,
    );
    await this.audit.record(
      {
        action: AuditAction.ORGANIZATION_MEMBER_ADDED,
        entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
        entityId: membershipId,
        actorUserId: actor.actorUserId,
        metadata: {
          organizationId,
          userId: details.veterinarianUserId,
          roleKey: 'VETERINARIAN',
          via: 'admin_poultry_supervision',
          supervisionType: details.supervisionType,
          startDate: details.startDate,
        },
        context: actor.context,
      },
      trx,
    );
    return membershipId;
  }

  private async detach(
    link: CurrentLink,
    actor: SupervisionActor,
    trx: Knex.Transaction,
  ): Promise<void> {
    await this.memberships.update(link.membershipId, { status: 'REMOVED' }, trx);
    await this.orgRbac.clearSupervisorPermissions(link.membershipId, trx);
    await this.audit.record(
      {
        action: AuditAction.ORGANIZATION_MEMBER_REMOVED,
        entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
        entityId: link.membershipId,
        actorUserId: actor.actorUserId,
        metadata: {
          organizationId: link.organizationId,
          userId: link.userId,
          roleKey: link.role,
          via: 'admin_poultry_supervision',
        },
        context: actor.context,
      },
      trx,
    );
  }

  private publishAdded(organizationId: string, userId: string): void {
    this.events.publish('organization.member.added', {
      organizationId,
      userId,
      roleKey: 'VETERINARIAN',
    });
  }

  private publishRemoved(link: CurrentLink): void {
    this.events.publish('organization.member.removed', {
      organizationId: link.organizationId,
      userId: link.userId,
    });
  }

  /** "ربط طبيب بحقل" — the farm must have no supervising vet yet. */
  async link(
    input: CreatePoultrySupervisionLinkInput,
    actor: SupervisionActor,
  ): Promise<{ membershipId: string }> {
    this.assertStartDate(input.startDate);
    const membershipId = await this.db.transaction(async (trx) => {
      const farm = await this.repo.findPoultryFarm(input.organizationId, trx);
      if (!farm) throw new NotFoundError('Poultry farm not found');
      await this.repo.lockFarm(farm.organizationId, trx);
      const current = await this.repo.currentLinksOfFarm(farm.organizationId, trx);
      if (current.length > 0) {
        throw new ConflictError('This farm already has a supervising veterinarian', {
          code: ErrorCode.FARM_ALREADY_SUPERVISED,
        });
      }
      return this.attach(farm.organizationId, input, actor, trx);
    });
    this.publishAdded(input.organizationId, input.veterinarianUserId);
    return { membershipId };
  }

  /**
   * "تغيير الطبيب المشرف" — in ONE transaction, end every current link of the
   * farm the membership belongs to and link the new vet (so the farm is never
   * left with zero or two supervisors by a half-applied change).
   */
  async replace(
    membershipId: string,
    input: LinkDetails,
    actor: SupervisionActor,
  ): Promise<{ membershipId: string }> {
    this.assertStartDate(input.startDate);
    const result = await this.db.transaction(async (trx) => {
      const link = await this.repo.findCurrentLink(membershipId, trx);
      if (!link) {
        throw new NotFoundError('This veterinarian is no longer linked to the farm', {
          code: ErrorCode.POULTRY_SUPERVISION_LINK_NOT_FOUND,
        });
      }
      await this.repo.lockFarm(link.organizationId, trx);
      const current = await this.repo.currentLinksOfFarm(link.organizationId, trx);
      if (current.some((l) => l.userId === input.veterinarianUserId)) {
        throw new ConflictError('This veterinarian already supervises this farm', {
          code: ErrorCode.FARM_ALREADY_SUPERVISED,
        });
      }
      for (const l of current) await this.detach(l, actor, trx);
      const newId = await this.attach(link.organizationId, input, actor, trx);
      return { removed: current, organizationId: link.organizationId, membershipId: newId };
    });
    for (const l of result.removed) this.publishRemoved(l);
    this.publishAdded(result.organizationId, input.veterinarianUserId);
    return { membershipId: result.membershipId };
  }

  /** "فك الارتباط" — the membership becomes REMOVED (its row is kept). */
  async unlink(membershipId: string, actor: SupervisionActor): Promise<void> {
    const link = await this.db.transaction(async (trx) => {
      const found = await this.repo.findCurrentLink(membershipId, trx);
      if (!found || !(SUPERVISING_ROLE_KEYS as readonly string[]).includes(found.role)) {
        throw new NotFoundError('This veterinarian is no longer linked to the farm', {
          code: ErrorCode.POULTRY_SUPERVISION_LINK_NOT_FOUND,
        });
      }
      await this.detach(found, actor, trx);
      return found;
    });
    this.publishRemoved(link);
  }
}
