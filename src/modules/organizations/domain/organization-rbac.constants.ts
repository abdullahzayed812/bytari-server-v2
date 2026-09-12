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
  // --- Sheep Farms & Cattle Farms (mirrors farm.poultry.* — the batch entity
  // is the only genuinely species-specific permission; daily_record/expense/
  // health_event/appointment/case/subscription below are already shared) ---
  'farm.sheep_batch.read',
  'farm.sheep_batch.create',
  'farm.sheep_batch.update',
  'farm.sheep_batch.delete',
  'farm.cattle_batch.read',
  'farm.cattle_batch.create',
  'farm.cattle_batch.update',
  'farm.cattle_batch.delete',
  // --- Poultry Farm operations (Poultry Farms module) — FARM organizations ---
  // The Farm Details screen: daily records + weekly/batch summaries, expenses,
  // treatments & vaccinations, appointments, individual cases. The farm-profile
  // header (image / address / capacity / establishment date / category) reuses
  // `organization.update`. Batch/weekly summaries read with `farm.poultry.read`.
  'farm.daily_record.read',
  'farm.daily_record.create',
  'farm.daily_record.update',
  'farm.daily_record.delete',
  'farm.expense.read',
  'farm.expense.create',
  'farm.expense.update',
  'farm.expense.delete',
  'farm.health_event.read',
  'farm.health_event.create',
  'farm.health_event.update',
  'farm.health_event.delete',
  'farm.appointment.read',
  'farm.appointment.create',
  'farm.appointment.update',
  'farm.appointment.delete',
  'farm.case.read',
  'farm.case.create',
  'farm.case.update',
  'farm.case.delete',
  // --- Farm subscription (Poultry Farm Approval & Subscription module) ---
  // Subscription dates live on `farm_details`, computed to a status
  // server-side. `read` is granted like every other `farm.*.read` key;
  // `manage` (set dates directly, approve/reject renewal requests) is granted
  // to NOBODY by default — reachable only via the OWNER override or an
  // explicit per-membership SUPERVISOR grant (the "Responsible Supervisor").
  'farm.subscription.read',
  'farm.subscription.manage',
  // --- Veterinary store products (Phase 10; extended to Veterinary Offices) —
  // VETERINARY_STORE / VETERINARY_OFFICE organizations ---
  // Stock changes are `product.inventory.adjust`, NOT `product.update` — a
  // controlled operation, never a free-form field edit.
  'product.read',
  'product.create',
  'product.update',
  'product.delete',
  'product.inventory.adjust',
  // --- Clinic appointments (Pet Owner ↔ Clinic booking) — CLINIC organizations ---
  // The Pet Owner books via authentication + pet-ownership only (no org
  // permission, like `animal.create`). These gate the future Clinic Dashboard:
  // `read` to view incoming requests, `manage` to accept / reject / propose a
  // reschedule / update status / complete.
  'clinic.appointment.read',
  'clinic.appointment.manage',
  // --- Veterinary Syndicates / Unions — SYNDICATE organizations ---
  // A syndicate (main or subordinate/branch) has NO self-service creation —
  // an ADMIN creates it directly and becomes its OWNER, then assigns
  // authorized officers as SUPERVISOR members with a subset of these keys
  // (the same "assign supervisor + pick permissions" flow every other
  // organization type already uses).
  'syndicate.profile.manage',
  'syndicate.announcement.manage',
  'syndicate.submission.read',
  'syndicate.submission.respond',
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
  'farm.sheep_batch.read': 'View this farm’s sheep batches',
  'farm.sheep_batch.create': 'Register a sheep batch for this farm',
  'farm.sheep_batch.update': 'Update this farm’s sheep batches',
  'farm.sheep_batch.delete': 'Delete this farm’s sheep batches',
  'farm.cattle_batch.read': 'View this farm’s cattle batches',
  'farm.cattle_batch.create': 'Register a cattle batch for this farm',
  'farm.cattle_batch.update': 'Update this farm’s cattle batches',
  'farm.cattle_batch.delete': 'Delete this farm’s cattle batches',
  'farm.daily_record.read': 'View a poultry batch’s daily records and weekly summary',
  'farm.daily_record.create': 'Add a daily record for a poultry batch',
  'farm.daily_record.update': 'Update a poultry batch’s daily record',
  'farm.daily_record.delete': 'Delete a poultry batch’s daily record',
  'farm.expense.read': 'View this farm’s expenses',
  'farm.expense.create': 'Record an expense for this farm',
  'farm.expense.update': 'Update this farm’s expenses',
  'farm.expense.delete': 'Delete this farm’s expenses',
  'farm.health_event.read': 'View this farm’s treatments and vaccinations',
  'farm.health_event.create': 'Record a treatment or vaccination for this farm',
  'farm.health_event.update': 'Update this farm’s treatments and vaccinations',
  'farm.health_event.delete': 'Delete this farm’s treatments and vaccinations',
  'farm.appointment.read': 'View this farm’s appointments',
  'farm.appointment.create': 'Schedule an appointment for this farm',
  'farm.appointment.update': 'Update this farm’s appointments',
  'farm.appointment.delete': 'Delete this farm’s appointments',
  'farm.case.read': 'View this farm’s individual cases',
  'farm.case.create': 'Open an individual case for this farm',
  'farm.case.update': 'Update this farm’s individual cases',
  'farm.case.delete': 'Delete this farm’s individual cases',
  'farm.subscription.read': 'View this farm’s subscription period and renewal requests',
  'farm.subscription.manage':
    'Set this farm’s subscription period and approve/reject its renewal requests',
  'product.read': 'View this store/office’s products',
  'product.create': 'Add a product to this store/office',
  'product.update': 'Update this store/office’s products (profile fields, not stock)',
  'product.delete': 'Deactivate (soft-delete) this store/office’s products',
  'product.inventory.adjust': 'Adjust a product’s stock quantity',
  'clinic.appointment.read': 'View appointment requests booked with this clinic',
  'clinic.appointment.manage':
    'Accept, reject, reschedule, complete or update the status of this clinic’s appointments',
  'syndicate.profile.manage': 'Update this syndicate’s profile fields and logo',
  'syndicate.announcement.manage': 'Create, update and delete this syndicate’s announcements',
  'syndicate.submission.read': 'View this syndicate’s requests and inquiries',
  'syndicate.submission.respond': 'Respond to and close this syndicate’s requests and inquiries',
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
    // Sheep Farms & Cattle Farms — mirrors the poultry flock grant above.
    'farm.sheep_batch.read',
    'farm.sheep_batch.create',
    'farm.sheep_batch.update',
    'farm.sheep_batch.delete',
    'farm.cattle_batch.read',
    'farm.cattle_batch.create',
    'farm.cattle_batch.update',
    'farm.cattle_batch.delete',
    // Poultry Farm operations — the farm veterinarian runs day-to-day
    // operations on the Farm Details screen.
    'farm.daily_record.read',
    'farm.daily_record.create',
    'farm.daily_record.update',
    'farm.daily_record.delete',
    'farm.expense.read',
    'farm.expense.create',
    'farm.expense.update',
    'farm.expense.delete',
    'farm.health_event.read',
    'farm.health_event.create',
    'farm.health_event.update',
    'farm.health_event.delete',
    'farm.appointment.read',
    'farm.appointment.create',
    'farm.appointment.update',
    'farm.appointment.delete',
    'farm.case.read',
    'farm.case.create',
    'farm.case.update',
    'farm.case.delete',
    'farm.subscription.read',
    // Clinic appointments — a clinic veterinarian runs the appointment desk on
    // the future Clinic Dashboard.
    'clinic.appointment.read',
    'clinic.appointment.manage',
  ],
  // Phase 6: farm STAFF (employees) can view poultry data; write access to
  // poultry stays with veterinarians / the owner / an assigned supervisor.
  // Poultry Farm operations follow the same rule — STAFF is read-only.
  // Phase 10: veterinary-store STAFF can view the product catalogue; create /
  // update / delete / inventory stay with the OWNER (override) or an explicitly
  // assigned SUPERVISOR — a Supervisor gets NO product permission by default.
  STAFF: [
    'organization.read',
    'farm.poultry.read',
    'farm.sheep_batch.read',
    'farm.cattle_batch.read',
    'farm.daily_record.read',
    'farm.expense.read',
    'farm.health_event.read',
    'farm.appointment.read',
    'farm.case.read',
    'farm.subscription.read',
    'product.read',
    'clinic.appointment.read',
  ],
};

export function isOrgRoleKey(value: string): value is OrgRoleKey {
  return (ORG_ROLE_KEYS as readonly string[]).includes(value);
}

export function isOrgPermissionKey(value: string): value is OrgPermissionKey {
  return (ORG_PERMISSION_KEYS as readonly string[]).includes(value);
}
