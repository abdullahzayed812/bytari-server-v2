/**
 * Organization RBAC catalogue — CONCEPTUALLY SEPARATE from the global RBAC of
 * Phase 2 (`src/modules/rbac/rbac.constants.ts`). Seeded into
 * `organization_roles` / `organization_permissions` / `organization_role_permissions`
 * by `0030_organization_rbac`. DB CHECK constraints mirror the key lists.
 */

export const ORG_ROLE_KEYS = ['OWNER', 'VETERINARIAN', 'SUPERVISOR', 'STAFF'] as const;
export type OrgRoleKey = (typeof ORG_ROLE_KEYS)[number];
export const OWNER_ORG_ROLE_KEY = 'OWNER' satisfies OrgRoleKey;
export const SUPERVISOR_ORG_ROLE_KEY = 'SUPERVISOR' satisfies OrgRoleKey;

export const ORG_PERMISSION_KEYS = [
  'organization.read',
  'organization.update',
  'member.read',
  'member.add',
  'member.remove',
  'member.update',
  'supervisor.read',
  'supervisor.assign',
  'supervisor.remove',
  'organization.veterinarian.read',
  'organization.veterinarian.manage',
  // --- Veterinary care (Phase 5) — CLINIC organizations ---
  // Access to an animal's veterinary information is gated by a dedicated
  // per-animal grant (`animal_clinic_access`) ON TOP of these permissions.
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
  // --- Farms & poultry (Phase 6) — FARM organizations ---
  // The join-code flow needs no permission (it is gated on APPROVED-vet status);
  // join-code regeneration reuses `organization.update`.
  'farm.poultry.read',
  'farm.poultry.create',
  'farm.poultry.update',
  'farm.poultry.delete',
  // --- Veterinary store products (Phase 10) — VETERINARY_STORE organizations ---
  // Stock changes are `product.inventory.adjust`, NOT `product.update` — a
  // controlled operation, never a free-form field edit.
  'product.read',
  'product.create',
  'product.update',
  'product.delete',
  'product.inventory.adjust',
] as const;
export type OrgPermissionKey = (typeof ORG_PERMISSION_KEYS)[number];

export const ORG_ROLE_DEFINITIONS: Record<OrgRoleKey, { name: string; description: string }> = {
  OWNER: {
    name: 'Owner',
    description:
      'Full control of the organization (within the organization permission catalogue). Bypasses per-permission checks via the organization-owner override.',
  },
  VETERINARIAN: {
    name: 'Veterinarian',
    description:
      'A veterinarian working with the organization. Must be a globally APPROVED veterinarian.',
  },
  SUPERVISOR: {
    name: 'Supervisor',
    description:
      'A veterinarian granted an explicitly-selected set of organization permissions by the owner. Has NO permissions by role alone.',
  },
  STAFF: {
    name: 'Staff',
    description: 'A non-veterinarian member of the organization.',
  },
};

export const ORG_PERMISSION_DEFINITIONS: Record<OrgPermissionKey, string> = {
  'organization.read': 'View the organization profile',
  'organization.update': 'Update the organization profile',
  'member.read': 'List and view organization members',
  'member.add': 'Add members to the organization',
  'member.remove': 'Remove members from the organization',
  'member.update': 'Change a member’s organization role or status',
  'supervisor.read': 'View organization supervisors',
  'supervisor.assign': 'Assign organization supervisors and choose their permissions',
  'supervisor.remove': 'Remove organization supervisors',
  'organization.veterinarian.read': 'View the organization’s veterinarians',
  'organization.veterinarian.manage': 'Manage the organization’s veterinarian relationships',
  'animal.veterinary.access.read': 'View the animals this clinic has veterinary access to',
  'animal.veterinary.access.manage': 'Grant or revoke this clinic’s veterinary access to an animal',
  'medical_record.read': 'Read an animal’s medical records (clinic must have veterinary access)',
  'medical_record.create': 'Add a medical record for an animal the clinic has access to',
  'medical_record.update': 'Update a medical record recorded by this clinic',
  'medical_record.delete': 'Delete a medical record recorded by this clinic',
  'vaccination.read': 'Read an animal’s vaccinations (clinic must have veterinary access)',
  'vaccination.create': 'Add a vaccination for an animal the clinic has access to',
  'vaccination.update': 'Update a vaccination recorded by this clinic',
  'vaccination.delete': 'Delete a vaccination recorded by this clinic',
  'farm.poultry.read': 'View this farm’s poultry flocks',
  'farm.poultry.create': 'Register a poultry flock for this farm',
  'farm.poultry.update': 'Update this farm’s poultry flocks',
  'farm.poultry.delete': 'Delete this farm’s poultry flocks',
  'product.read': 'View this veterinary store’s products',
  'product.create': 'Add a product to this veterinary store',
  'product.update': 'Update this veterinary store’s products (profile fields, not stock)',
  'product.delete': 'Deactivate (soft-delete) this veterinary store’s products',
  'product.inventory.adjust': 'Adjust a product’s stock quantity',
};

/**
 * Role → permission grants applied by the seed.
 * - OWNER: empty — full access via the organization-owner override.
 * - SUPERVISOR: empty — the owner selects permissions per-membership.
 */
export const ORG_ROLE_PERMISSIONS: Record<OrgRoleKey, OrgPermissionKey[]> = {
  OWNER: [],
  SUPERVISOR: [],
  VETERINARIAN: [
    'organization.read',
    'member.read',
    'organization.veterinarian.read',
    // Phase 5: an assigned clinic veterinarian gets full CRUD on the veterinary
    // history of animals the clinic has access to (docs 01 §1.3.3, UC-016/UC-017),
    // and can see the clinic's patient list. Deciding WHICH animals the clinic
    // takes on (`animal.veterinary.access.manage`) stays an owner / supervisor
    // action so a veterinarian never gains blanket access to every animal.
    'animal.veterinary.access.read',
    'medical_record.read',
    'medical_record.create',
    'medical_record.update',
    'medical_record.delete',
    'vaccination.read',
    'vaccination.create',
    'vaccination.update',
    'vaccination.delete',
    // Phase 6: a farm veterinarian manages the farm's poultry flocks (docs 04
    // §4.10 "Poultry Operations"). Farm profile / membership management stay on
    // the existing `organization.*` / `member.*` permissions.
    'farm.poultry.read',
    'farm.poultry.create',
    'farm.poultry.update',
    'farm.poultry.delete',
  ],
  // Phase 6: farm STAFF (employees) can view poultry data; write access to
  // poultry stays with veterinarians / the owner / an assigned supervisor.
  // Phase 10: veterinary-store STAFF can view the product catalogue; create /
  // update / delete / inventory stay with the OWNER (override) or an explicitly
  // assigned SUPERVISOR — a Supervisor gets NO product permission by default.
  STAFF: ['organization.read', 'farm.poultry.read', 'product.read'],
};

export function isOrgRoleKey(value: string): value is OrgRoleKey {
  return (ORG_ROLE_KEYS as readonly string[]).includes(value);
}

export function isOrgPermissionKey(value: string): value is OrgPermissionKey {
  return (ORG_PERMISSION_KEYS as readonly string[]).includes(value);
}
