import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { OrganizationPolicy } from '../../organizations/domain/organization.policy.js';
import type { OrganizationMembershipSummary } from '../../organizations/domain/organization.types.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { OrganizationRbacRepository } from '../../organizations/infrastructure/organization-rbac.repository.js';
import { FarmPolicy } from '../domain/farm.policy.js';
import type { FarmDetailsRepository } from '../infrastructure/farm-details.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

const MAX_CODE_ATTEMPTS = 5;

/**
 * The Farm-ID / join-code flow deferred from Phase 3 (docs 05 UC-013):
 * a veterinarian submits a farm's code and becomes a member — no invitation,
 * no acceptance, no admin approval. Membership uses the existing
 * `organization_memberships` model; this service adds only the code lookup,
 * the "no second workflow" join, and code regeneration.
 */
export class FarmJoinService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly farmDetails: FarmDetailsRepository,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly orgRbac: OrganizationRbacRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'farm-join-service' });
  }

  /** Join a farm by its code. Idempotent for an existing ACTIVE member. */
  async joinByCode(
    joinCode: string,
    actor: FarmActor,
  ): Promise<{ membership: OrganizationMembershipSummary; alreadyMember: boolean }> {
    const joiner = await this.users.getById(actor.actorUserId);
    // A VETERINARIAN membership requires an APPROVED veterinarian (spec §15 /
    // docs 01 §1.3.6). Re-checked here even though the route also guards it.
    OrganizationPolicy.assertCanHoldRole('VETERINARIAN', joiner);

    const organizationId = await this.farmDetails.findOrganizationIdByJoinCode(joinCode);
    if (!organizationId) {
      throw new NotFoundError('Invalid farm join code', { code: ErrorCode.INVALID_JOIN_CODE });
    }

    const org = await this.organizations.findById(organizationId);
    if (!org) throw new InternalError('join code points at a missing organization');
    FarmPolicy.assertFarmOrganization(org);
    FarmPolicy.assertFarmJoinable(org);

    const vetRole = await this.orgRbac.findRoleByKey('VETERINARIAN');
    if (!vetRole) throw new InternalError('Seed data missing: organization role "VETERINARIAN"');

    const result = await this.db.transaction(async (tx) => {
      const existing = await this.memberships.findByUserAndOrg(
        actor.actorUserId,
        organizationId,
        tx,
      );
      const action = FarmPolicy.resolveJoinAction(existing ? existing.status : null);

      if (action === 'noop' && existing) {
        return { membershipId: existing.id, alreadyMember: true };
      }

      let membershipId: string;
      if (action === 'reactivate' && existing) {
        const m = await this.memberships.update(
          existing.id,
          {
            organizationRoleId: vetRole.id,
            status: 'ACTIVE',
            addedBy: actor.actorUserId,
          },
          tx,
        );
        membershipId = m.id;
      } else {
        const m = await this.memberships.create(
          {
            organizationId,
            userId: actor.actorUserId,
            organizationRoleId: vetRole.id,
            status: 'ACTIVE',
            addedBy: actor.actorUserId,
          },
          tx,
        );
        membershipId = m.id;
      }

      await this.audit.record(
        {
          action: AuditAction.FARM_MEMBER_JOINED,
          entityType: AuditEntityType.ORGANIZATION_MEMBERSHIP,
          entityId: membershipId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            userId: actor.actorUserId,
            roleKey: 'VETERINARIAN',
            via: 'join_code',
            reactivated: action === 'reactivate',
          },
          context: actor.context,
        },
        tx,
      );

      return { membershipId, alreadyMember: false };
    });

    if (!result.alreadyMember) {
      this.events.publish('farm.member.joined', {
        organizationId,
        userId: actor.actorUserId,
        membershipId: result.membershipId,
      });
    }

    const summary = await this.memberships.findSummaryByIdInOrg(
      result.membershipId,
      organizationId,
    );
    if (!summary) throw new InternalError('membership vanished after join');
    return { membership: summary, alreadyMember: result.alreadyMember };
  }

  /** Rotate a farm's join code (e.g. after it leaks). Requires `organization.update`. */
  async regenerateJoinCode(
    organizationId: string,
    org: { type: string },
    actor: FarmActor,
  ): Promise<{ joinCode: string }> {
    FarmPolicy.assertFarmOrganization(org);

    const joinCode = await this.db.transaction(async (tx) => {
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const candidate = OrganizationPolicy.generateJoinCode();
        // A collision would abort the surrounding transaction, so probe first.
        const clash = await this.farmDetails.findOrganizationIdByJoinCode(candidate, tx);
        if (clash) continue;

        const updated = await this.farmDetails.setJoinCode(organizationId, candidate, tx);
        if (updated !== 1) {
          throw new InternalError('farm_details row missing for a FARM organization');
        }
        await this.audit.record(
          {
            action: AuditAction.FARM_JOIN_CODE_REGENERATED,
            entityType: AuditEntityType.ORGANIZATION,
            entityId: organizationId,
            actorUserId: actor.actorUserId,
            metadata: { organizationId },
            context: actor.context,
          },
          tx,
        );
        return candidate;
      }
      throw new InternalError('could not generate a unique join code');
    });

    this.events.publish('farm.join_code.regenerated', { organizationId });
    return { joinCode };
  }

  /** Read the current join code (owner-facing; requires `organization.update`). */
  async getJoinCode(organizationId: string, org: { type: string }): Promise<{ joinCode: string }> {
    FarmPolicy.assertFarmOrganization(org);
    const joinCode = await this.farmDetails.getJoinCode(organizationId);
    if (!joinCode) throw new NotFoundError('This organization has no join code');
    return { joinCode };
  }
}
