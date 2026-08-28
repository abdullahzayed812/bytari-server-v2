import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { FARM_ORG_TYPE } from './farm.constants.js';

/**
 * Farm/poultry business rules. Pure — no I/O. Type-specific organization rules
 * that belong to the shared catalogue live in `OrganizationPolicy`; this covers
 * only the farm/poultry additions.
 */
export const FarmPolicy = {
  /** Poultry lives only on FARM organizations (Phase 6 scope). */
  assertFarmOrganization(org: { type: string }): void {
    if (org.type !== FARM_ORG_TYPE) {
      throw new BadRequestError('This operation is only available for farm organizations', {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
    }
  },

  /**
   * A farm must be ACTIVE to be joined via its code (spec §3 / docs 01 §1.3.6).
   * A PENDING / REJECTED / SUSPENDED / DEACTIVATED farm cannot be joined.
   */
  assertFarmJoinable(org: { status: string }): void {
    if (org.status !== 'ACTIVE') {
      throw new ConflictError('This farm is not active and cannot be joined', {
        code: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      });
    }
  },

  /**
   * Decide what a code-based join does with an existing membership row.
   *  - none / LEFT  → (re)join as VETERINARIAN
   *  - ACTIVE       → already a member; return it unchanged (idempotent)
   *  - SUSPENDED / REMOVED → ended by the organization; self-service rejoin is refused
   */
  resolveJoinAction(
    membershipStatus: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' | 'LEFT' | null,
  ): 'create' | 'reactivate' | 'noop' {
    if (membershipStatus === null || membershipStatus === 'LEFT') {
      return membershipStatus === null ? 'create' : 'reactivate';
    }
    if (membershipStatus === 'ACTIVE') return 'noop';
    throw new ForbiddenError(
      'Your membership of this farm was ended by the organization; contact the farm owner',
      { code: ErrorCode.PERMISSION_DENIED },
    );
  },

  /** A poultry flock must be ACTIVE for updates (a CLOSED batch is historical). */
  assertFlockMutable(flock: { status: string }): void {
    if (flock.status !== 'ACTIVE') {
      throw new ConflictError('This poultry flock is closed and cannot be modified', {
        code: ErrorCode.POULTRY_FLOCK_NOT_ACTIVE,
      });
    }
  },
} as const;
