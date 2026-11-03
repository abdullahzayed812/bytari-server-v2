import { randomBytes } from 'node:crypto';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  ORG_ROLE_PERMISSIONS,
  STORE_ORGANIZATION_TYPES,
  STORE_SUPERVISOR_PERMISSION_KEYS,
} from './organization-rbac.constants.js';
import type { OrganizationType } from './organization.types.js';

/**
 * The single place organization-**type**-specific rules live. Nothing else in
 * the codebase should branch on `organization.type`. Extend the methods here as
 * new types / rules arrive.
 */

/**
 * Organization types whose owner MUST be a globally APPROVED veterinarian.
 *
 * FARM is intentionally NOT here: a Pet Owner (any ACTIVE user) can create
 * their own poultry farm through the "Add Poultry Farm" form. The farm is still
 * created as `PENDING` and reviewed by an admin before it goes ACTIVE, and the
 * creator is only ever an organization-scoped OWNER — never a new global role.
 * Joining an *existing* farm as a VETERINARIAN member still requires approval
 * (`assertCanHoldRole` / the join-code route guard).
 */
const VET_OWNER_REQUIRED: ReadonlySet<OrganizationType> = new Set<OrganizationType>(['CLINIC']);

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
  // CHAT_ROOM only wants the logo (room image) + name/description out of this
  // shape — the mobile room-edit form simply never renders the unused
  // address/phone/services/social fields. Reuses the logo upload/replace/
  // remove endpoints wholesale instead of building a third image seam.
  'CHAT_ROOM',
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
   * a globally APPROVED veterinarian (spec §15) — EXCEPT for CHAT_ROOM /
   * SYNDICATE (any account), and a CLINIC / VETERINARY_OFFICE "store
   * supervisor": an existing member granted only store-level keys.
   */
  assertCanBeSupervisor(
    type: OrganizationType,
    target: { veterinarianStatus: string },
    storeGrant?: { isActiveMember: boolean; permissions: readonly string[] },
  ): void {
    // A room moderator / syndicate admin ("مسؤول النقابة") is chosen directly
    // by a global Admin and manages only that one room/syndicate — any active
    // account may hold it, not only approved veterinarians.
    if (type === 'CHAT_ROOM' || type === 'SYNDICATE') return;
    if (target.veterinarianStatus === 'APPROVED') return;
    // Store supervisor: a CLINIC / VETERINARY_OFFICE owner may pick ANY of
    // their existing members (e.g. a non-veterinarian employee) to run the
    // store — but only with store keys (+ what an employee already has),
    // never clinical / management rights.
    if (
      storeGrant &&
      (STORE_ORGANIZATION_TYPES as readonly string[]).includes(type) &&
      storeGrant.isActiveMember &&
      OrganizationPolicy.isNonVeterinarianSupervisorGrant(storeGrant.permissions)
    ) {
      return;
    }
    throw new ForbiddenError(
      'Only an approved veterinarian can be assigned as an organization supervisor',
      { code: ErrorCode.VETERINARIAN_APPROVAL_REQUIRED },
    );
  },

  /**
   * A non-veterinarian supervisor's grant may hold only store keys
   * (products + incoming orders) and keys an employee (STAFF role) already has.
   */
  isNonVeterinarianSupervisorGrant(permissions: readonly string[]): boolean {
    const allowed = new Set<string>([
      ...STORE_SUPERVISOR_PERMISSION_KEYS,
      ...ORG_ROLE_PERMISSIONS.STAFF,
    ]);
    return permissions.every((p) => allowed.has(p));
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

/**
 * Memberships that make a FARM "one of my farms" in the Poultry / Sheep /
 * Cattle sections: the OWNER and the farm's own STAFF (employees run the
 * dashboard). A VETERINARIAN / SUPERVISOR added to supervise the farm is NOT
 * an owner — that farm shows only under "My Organizations".
 */
const FARM_SECTION_ROLES: ReadonlySet<string> = new Set(['OWNER', 'STAFF']);

export function isFarmSectionMembership(org: { type: string; myRole: string }): boolean {
  return org.type === 'FARM' && FARM_SECTION_ROLES.has(org.myRole);
}
