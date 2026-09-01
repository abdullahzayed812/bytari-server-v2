import { randomBytes } from 'node:crypto';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { OrganizationType } from './organization.types.js';

/**
 * The single place organization-**type**-specific rules live. Nothing else in
 * the codebase should branch on `organization.type`. Extend the methods here as
 * new types / rules arrive.
 */

/** Organization types whose owner MUST be a globally APPROVED veterinarian. */
const VET_OWNER_REQUIRED: ReadonlySet<OrganizationType> = new Set<OrganizationType>([
  'CLINIC',
  'FARM',
]);

/** Organization types that carry a Farm-ID style join code. */
const HAS_JOIN_CODE: ReadonlySet<OrganizationType> = new Set<OrganizationType>(['FARM']);

/**
 * Organization types with a public directory profile (address / coordinates /
 * phone / logo) — the Pet Owner marketplace pages. FARM is excluded: it isn't
 * browsed as a directory, it's joined via `join_code`.
 */
const HAS_PROFILE_FIELDS: ReadonlySet<OrganizationType> = new Set<OrganizationType>([
  'CLINIC',
  'VETERINARY_OFFICE',
  'VETERINARY_STORE',
]);

export interface OrganizationCreatorContext {
  status: string;
  veterinarianStatus: string;
}

export const OrganizationPolicy = {
  ownerMustBeApprovedVeterinarian(type: OrganizationType): boolean {
    return VET_OWNER_REQUIRED.has(type);
  },

  hasJoinCode(type: OrganizationType): boolean {
    return HAS_JOIN_CODE.has(type);
  },

  hasProfileFields(type: OrganizationType): boolean {
    return HAS_PROFILE_FIELDS.has(type);
  },

  /** Throws if `type` has no directory profile (address/coords/phone/logo). */
  assertHasProfileFields(type: OrganizationType): void {
    if (!HAS_PROFILE_FIELDS.has(type)) {
      throw new BadRequestError(`${type} organizations do not have a directory profile`, {
        code: ErrorCode.ORGANIZATION_TYPE_NOT_SUPPORTED,
      });
    }
  },

  /**
   * May `user` create an organization of `type`? Throws {@link ForbiddenError}
   * otherwise. The veterinarian check consults `veterinarianStatus` — never the
   * global role alone.
   */
  assertCanCreate(type: OrganizationType, user: OrganizationCreatorContext): void {
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenError('Your account must be active to create an organization');
    }
    if (
      OrganizationPolicy.ownerMustBeApprovedVeterinarian(type) &&
      user.veterinarianStatus !== 'APPROVED'
    ) {
      throw new ForbiddenError(
        `Creating a ${type} organization requires an approved veterinarian account`,
        { code: ErrorCode.VETERINARIAN_APPROVAL_REQUIRED },
      );
    }
  },

  /**
   * May `target` be assigned as an organization SUPERVISOR? A supervisor must be
   * a globally APPROVED veterinarian (spec §15).
   */
  assertCanBeSupervisor(target: { veterinarianStatus: string }): void {
    if (target.veterinarianStatus !== 'APPROVED') {
      throw new ForbiddenError(
        'Only an approved veterinarian can be assigned as an organization supervisor',
        { code: ErrorCode.VETERINARIAN_APPROVAL_REQUIRED },
      );
    }
  },

  /**
   * May `target` be added to an organization with the given org role?
   * Adding someone as VETERINARIAN requires them to be a globally approved vet.
   */
  assertCanHoldRole(orgRoleKey: string, target: { veterinarianStatus: string }): void {
    if (orgRoleKey === 'VETERINARIAN' && target.veterinarianStatus !== 'APPROVED') {
      throw new ForbiddenError(
        'Only an approved veterinarian can hold the VETERINARIAN organization role',
        { code: ErrorCode.VETERINARIAN_APPROVAL_REQUIRED },
      );
    }
  },

  /** Per-type structural validation of creation input. No-op today; extension point. */
  validateTypeSpecificRules(_type: OrganizationType, _input: unknown): void {
    /* intentionally empty — types have no confirmed unique fields yet */
  },

  /** Farm-ID style join code, e.g. `FARM-8F3K9Q`. */
  generateJoinCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(6);
    let code = '';
    for (const b of bytes) code += alphabet[b % alphabet.length];
    return `FARM-${code}`;
  },
} as const;
