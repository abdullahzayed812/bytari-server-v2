/**
 * Phase 5 — Veterinary Care domain constants.
 *
 * All authorization for this module is ORGANIZATION-scoped (a CLINIC context)
 * plus a dedicated per-animal access grant. Nothing here is a global permission.
 */

/** Access-grant lifecycle for `animal_clinic_access`. */
export const CLINIC_ACCESS_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type ClinicAccessStatus = (typeof CLINIC_ACCESS_STATUSES)[number];

/** Organization types that may hold veterinary access to an animal (Phase 5). */
export const VETERINARY_ORG_TYPES = ['CLINIC'] as const;
export type VeterinaryOrgType = (typeof VETERINARY_ORG_TYPES)[number];

/**
 * Organization-RBAC permission keys introduced by Phase 5. Mirrored into
 * `ORG_PERMISSION_KEYS` / `ORG_PERMISSION_DEFINITIONS` / `ORG_ROLE_PERMISSIONS`
 * in `organization-rbac.constants.ts` (single source of truth for the seed).
 */
export const VETERINARY_CARE_ORG_PERMISSION_KEYS = [
  'animal.veterinary.access.read',
  'animal.veterinary.access.manage',
  'medical_record.read',
  'medical_record.create',
  'medical_record.update',
  'medical_record.delete',
  'vaccination.read',
  'vaccination.create',
  'vaccination.update',
  'vaccination.delete',
] as const;
export type VeterinaryCareOrgPermissionKey = (typeof VETERINARY_CARE_ORG_PERMISSION_KEYS)[number];
