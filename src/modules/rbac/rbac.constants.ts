/**
 * The single source of truth for Phase 2 roles, permissions and supervisor
 * domains. DB rows are seeded from these; runtime CHECK constraints mirror the
 * enum lists. Future modules append their own permissions — they do NOT edit
 * this file's role→permission matrix beyond their concern.
 */

export const ROLE_KEYS = ['ADMIN', 'MODERATOR', 'PET_OWNER', 'VETERINARIAN'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const ADMIN_ROLE_KEY = 'ADMIN' satisfies RoleKey;

export const PERMISSION_KEYS = [
  'user.read',
  'user.create',
  'user.update',
  'user.delete',
  'user.suspend',
  'user.activate',
  'user.deactivate',
  'role.read',
  'role.assign',
  'permission.read',
  'permission.assign',
  'veterinarian.read',
  'veterinarian.approve',
  'veterinarian.reject',
  'supervisor.read',
  'supervisor.assign',
  'supervisor.remove',
  'audit.read',
  // Phase 3 — system-wide organization administration (distinct from the
  // organization-scoped permissions in `organization_permissions`).
  'organization.admin.read',
  'organization.admin.approve',
  'organization.admin.status',
  'organization.admin.manage',
  // Poultry Farms module — farm subscription administration (spec §4/§6):
  // setting a farm's subscription period directly, and approving/rejecting
  // subscription renewal requests. Granted to NO base role (ADMIN override).
  'organization.admin.subscription',
  // Phase 4 — animals. Normal access is OWNERSHIP-scoped (owner-or-ADMIN); these
  // exist for the ADMIN override and future Animal-Supervisor delegation, and
  // are granted to NO role by default.
  'animal.read',
  'animal.create',
  'animal.update',
  'animal.delete',
  'animal.ownership.read',
  'animal.ownership.transfer',
  // Phase 7 — animal-publication moderation (Lost / Adoption / Mating).
  // Held via the ANIMAL system-supervisor domain (docs 03 §3.10) or ADMIN
  // override — granted to NO base role.
  'animal.approve',
  'animal.reject',
  // Phase 12 — chat. Normal chat access is RELATIONSHIP-scoped (conversation
  // participant / current organization membership), exactly like Phase 4
  // animals. These keys exist for the ADMIN override and a future
  // Communication-Supervisor delegation, and are granted to NO base role.
  'chat.read',
  'chat.send',
  'chat.delete',
  // Phase 13 — consultations & inquiries. CREATOR access is relationship-scoped
  // (`created_by_user_id`); RESPONDER access comes from the ADMIN override or an
  // ACTIVE CONSULTATION / INQUIRY system-supervisor domain assignment (see
  // SUPERVISOR_DOMAIN_PERMISSIONS below). `*.create` is reserved — creation is
  // authentication + eligibility only, like `animal.create`.
  'consultation.create',
  'consultation.read',
  'consultation.respond',
  'consultation.close',
  'consultation.admin.read',
  'inquiry.create',
  'inquiry.read',
  'inquiry.respond',
  'inquiry.close',
  'inquiry.admin.read',
  // Support messages ("تواصل معنا" / contact the administration). Any signed-in
  // user creates one; RESPONDER access is the ADMIN override or an ACTIVE
  // SUPPORT system-supervisor domain assignment. `support.create` is reserved —
  // creation is authentication-only (no eligibility gate, unlike inquiries).
  'support.create',
  'support.read',
  'support.respond',
  'support.close',
  'support.admin.read',
  // Veterinary Services marketplace — service LISTINGS + pet-owner REQUESTS
  // require approval before becoming public. Held by ADMIN (override) or an
  // ACTIVE VET_SERVICE system-supervisor. Granted to NO base role.
  'vet_service.read',
  'vet_service.approve',
  'vet_service.reject',
  // Admin-only: enable/disable AI responses for consultations / inquiries.
  'ai.settings.manage',
  // Phase 14 — content management (articles / books / magazines). Public reads
  // are NOT permission-gated. These are held by ADMIN (override) or a CONTENT
  // system-supervisor (see SUPERVISOR_DOMAIN_PERMISSIONS — everything except
  // `content.delete`, which stays ADMIN-only). Granted to NO base role.
  'content.read',
  'content.create',
  'content.update',
  'content.delete',
  'content.publish',
  'content.archive',
  'content.upload',
  'content.category.manage',
  // Phase 15 — notifications. Personal notification / device-token endpoints are
  // authentication + ownership only (no permission key). This one gates the
  // ADMIN broadcast; granted to NO base role (ADMIN override).
  'notification.admin.send',
  // Advertisements — multi-section campaigns (BANNER / CAROUSEL) + ordered
  // slides. Public reads are NOT permission-gated. Held by ADMIN (override) or
  // an ADVERTISEMENT system-supervisor; governs every placement. Granted to NO
  // base role.
  'advertisement.manage',
  // Poultry Markets — trader registration review. Held by ADMIN (override) or
  // MODERATOR (read-only oversight, mirrors 'veterinarian.read'). Approve /
  // reject / suspend are granted to NO base role.
  'trader.admin.read',
  'trader.admin.approve',
  'trader.admin.reject',
  'trader.admin.suspend',
  // Poultry Markets — offer moderation (delete any poultry/egg offer) and
  // exchange-rate board entry. Held by ADMIN (override) or a MARKET
  // system-supervisor (see SUPERVISOR_DOMAIN_PERMISSIONS). Granted to NO base role.
  'market.offer.admin.read',
  'market.offer.admin.delete',
  'market.rate.manage',
  // Pet Owners Store — a platform-run consumer storefront. Consumer browse /
  // cart / checkout / order-history are authentication-only (no key). These
  // gate management, held by ADMIN (override) or a PET_OWNER_STORE
  // system-supervisor (see SUPERVISOR_DOMAIN_PERMISSIONS). Granted to NO base role.
  'pet_store.product.manage',
  'pet_store.category.manage',
  'pet_store.order.manage',
  // Veterinarian Store — a platform-run consumer storefront for
  // Veterinarian-mode users, mirroring Pet Owners Store but with its own
  // dedicated tables/catalogue. Consumer browse / cart / checkout /
  // order-history are authentication-only (no key). These gate management,
  // held by ADMIN (override) or a VETERINARIAN_STORE system-supervisor (see
  // SUPERVISOR_DOMAIN_PERMISSIONS). Granted to NO base role.
  'veterinarian_store.product.manage',
  'veterinarian_store.category.manage',
  'veterinarian_store.order.manage',
  // Veterinarian Jobs / Careers — job offers (employer-posted) and job-seeker
  // profiles are both moderated PENDING → APPROVED/REJECTED, mirroring the
  // Veterinary Services marketplace. Held by ADMIN (override) or an ACTIVE
  // VET_JOBS system-supervisor (see SUPERVISOR_DOMAIN_PERMISSIONS). Granted to
  // NO base role.
  'vet_job.read',
  'vet_job.approve',
  'vet_job.reject',
  // Veterinarian Courses & Seminars — courses/seminars/workshops are
  // moderated PENDING → APPROVED/REJECTED, mirroring Veterinarian Jobs. Held
  // by ADMIN (override) or an ACTIVE VET_COURSES system-supervisor (see
  // SUPERVISOR_DOMAIN_PERMISSIONS). Granted to NO base role.
  'vet_course.read',
  'vet_course.approve',
  'vet_course.reject',
  // Veterinary Syndicates / Unions — a syndicate (main or subordinate) is
  // never self-service; only an ADMIN creates one (it then becomes an
  // `organizations` row of type SYNDICATE, managed via the existing
  // organization-scoped `syndicate.*` permissions — see
  // `organization-rbac.constants.ts`). Granted to NO base role.
  'syndicate.admin.create',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const SUPERVISOR_DOMAINS = [
  'ANIMAL',
  'CLINIC',
  'STORE',
  'CONTENT',
  'CONSULTATION',
  'INQUIRY',
  'SUPPORT',
  'VET_SERVICE',
  'ADVERTISEMENT',
  'MARKET',
  'PET_OWNER_STORE',
  'VETERINARIAN_STORE',
  'VET_JOBS',
  'VET_COURSES',
] as const;
export type SupervisorDomain = (typeof SUPERVISOR_DOMAINS)[number];

export const ROLE_DEFINITIONS: Record<RoleKey, { name: string; description: string }> = {
  ADMIN: {
    name: 'Administrator',
    description:
      'Full system access. Bypasses per-permission checks via the authorization override.',
  },
  MODERATOR: {
    name: 'Moderator',
    description:
      'Administrative/oversight base role. Capabilities come from explicitly granted permissions and supervisor assignments — not from the role alone.',
  },
  PET_OWNER: {
    name: 'Pet Owner',
    description: 'Operate as a pet owner. Granted to every user on registration.',
  },
  VETERINARIAN: {
    name: 'Veterinarian',
    description:
      'Operate as a veterinarian. Veterinarian-only capabilities require veterinarianStatus = APPROVED.',
  },
};

export const PERMISSION_DEFINITIONS: Record<PermissionKey, string> = {
  'user.read': 'List and view user accounts',
  'user.create': 'Create user accounts',
  'user.update': 'Update user profile fields',
  'user.delete': 'Delete user accounts (reserved — Phase 2 uses deactivation instead)',
  'user.suspend': 'Suspend a user account',
  'user.activate': 'Re-activate a suspended/deactivated account',
  'user.deactivate': 'Deactivate a user account',
  'role.read': 'List roles and their permissions',
  'role.assign': 'Assign and remove global roles on users',
  'permission.read': 'List permissions',
  'permission.assign': 'Attach and detach permissions on roles',
  'veterinarian.read': 'View veterinarian applications',
  'veterinarian.approve': 'Approve veterinarian applications',
  'veterinarian.reject': 'Reject veterinarian applications',
  'supervisor.read': 'View system supervisor assignments',
  'supervisor.assign': 'Assign system supervisors',
  'supervisor.remove': 'Remove system supervisor assignments',
  'audit.read': 'Read the audit log',
  'organization.admin.read': 'List and view any organization (system-wide)',
  'organization.admin.approve': 'Approve or reject pending organizations',
  'organization.admin.status': 'Suspend, activate or deactivate organizations',
  'organization.admin.manage': 'Remove members / supervisors from any organization',
  'organization.admin.subscription':
    'Set a farm’s subscription period and approve/reject subscription renewal requests',
  'animal.read': 'View an animal outside of ownership (delegated / oversight)',
  'animal.create': 'Create animals (reserved — Phase 4 create is authentication-only)',
  'animal.update': 'Update an animal outside of ownership (delegated / oversight)',
  'animal.delete': 'Deactivate an animal outside of ownership (delegated / oversight)',
  'animal.ownership.read': 'View an animal’s ownership history outside of ownership',
  'animal.ownership.transfer':
    'Transfer animal ownership outside of ownership (reserved — Phase 4 transfer is owner-or-ADMIN)',
  'animal.approve': 'Approve a pending Lost / Adoption / Mating animal publication',
  'animal.reject': 'Reject a pending Lost / Adoption / Mating animal publication',
  'chat.read': 'Read chat conversations / messages outside of participation (oversight)',
  'chat.send': 'Send chat messages outside of participation (oversight)',
  'chat.delete': 'Delete chat messages outside of ownership (moderation)',
  'consultation.create': 'Create a consultation (reserved — creation is authentication-only)',
  'consultation.read': 'Read a consultation as a responder (supervisor / admin oversight)',
  'consultation.respond': 'Post a response message on a consultation',
  'consultation.close': 'Close a consultation',
  'consultation.admin.read': 'List and view any consultation (system-wide)',
  'inquiry.create': 'Create an inquiry (reserved — creation is authentication-only)',
  'inquiry.read': 'Read an inquiry as a responder (supervisor / admin oversight)',
  'inquiry.respond': 'Post a response message on an inquiry',
  'inquiry.close': 'Close an inquiry',
  'inquiry.admin.read': 'List and view any inquiry (system-wide)',
  'support.create': 'Create a support message (reserved — creation is authentication-only)',
  'support.read': 'Read a support message as a responder (supervisor / admin oversight)',
  'support.respond': 'Post a response message on a support message',
  'support.close': 'Close a support message',
  'support.admin.read': 'List and view any support message (system-wide)',
  'vet_service.read': 'View pending vet-service listings / requests for moderation',
  'vet_service.approve': 'Approve a pending vet-service listing / pet-owner request',
  'vet_service.reject': 'Reject a pending vet-service listing / pet-owner request',
  'ai.settings.manage': 'Enable or disable AI responses for consultations / inquiries',
  'content.read': 'List and view content in any state (DRAFT / ARCHIVED included)',
  'content.create': 'Create content items (articles / books / magazines)',
  'content.update': 'Update content fields and category assignments',
  'content.delete': 'Soft-delete and restore content items',
  'content.publish': 'Publish content (make it publicly visible)',
  'content.archive': 'Archive content (remove it from public listings)',
  'content.upload': 'Request upload URLs and register / replace / delete content files',
  'content.category.manage': 'Create, update and delete content categories',
  'notification.admin.send': 'Send an administrative notification to a user / role / all users',
  'advertisement.manage':
    'Create, update, activate/deactivate and delete advertisement campaigns and slides across all placements',
  'trader.admin.read': 'View trader registration profiles/applications',
  'trader.admin.approve': 'Approve a pending trader registration',
  'trader.admin.reject': 'Reject a pending trader registration',
  'trader.admin.suspend': 'Suspend or reactivate an approved trader',
  'market.offer.admin.read': 'List and view any poultry/egg market offer (system-wide)',
  'market.offer.admin.delete': 'Delete any poultry/egg market offer (moderation)',
  'market.rate.manage': 'Enter/update the poultry and egg exchange-rate boards',
  'pet_store.product.manage':
    'Create, update, deactivate and manage images for Pet Owners Store products',
  'pet_store.category.manage': 'Create, update and delete Pet Owners Store product categories',
  'pet_store.order.manage': 'List and view any Pet Owners Store order and update its status',
  'veterinarian_store.product.manage':
    'Create, update, deactivate and manage images for Veterinarian Store products',
  'veterinarian_store.category.manage':
    'Create, update and delete Veterinarian Store product categories',
  'veterinarian_store.order.manage':
    'List and view any Veterinarian Store order and update its status',
  'vet_job.read': 'View pending Veterinarian Jobs offers / seeker profiles for moderation',
  'vet_job.approve': 'Approve a pending job offer / job-seeker profile',
  'vet_job.reject': 'Reject a pending job offer / job-seeker profile',
  'vet_course.read': 'View pending Veterinarian Courses & Seminars submissions for moderation',
  'vet_course.approve': 'Approve a pending course / seminar / workshop',
  'vet_course.reject': 'Reject a pending course / seminar / workshop',
  'syndicate.admin.create': 'Create a main or subordinate veterinary syndicate',
};

/**
 * Fixed permission set implied by holding an ACTIVE system-supervisor
 * assignment for a domain (docs 03 §3.10). System supervisors carry no
 * per-assignment permission rows — the domain itself grants this set.
 * `AuthorizationService.can()` consults this as a fallback after global roles.
 */
export const SUPERVISOR_DOMAIN_PERMISSIONS: Record<SupervisorDomain, readonly PermissionKey[]> = {
  ANIMAL: ['animal.read', 'animal.update', 'animal.approve', 'animal.reject'],
  CLINIC: [],
  STORE: [],
  // The responsible Content Supervisor (Phase 14): full content management
  // EXCEPT `content.delete`, which stays ADMIN-only.
  CONTENT: [
    'content.read',
    'content.create',
    'content.update',
    'content.publish',
    'content.archive',
    'content.upload',
    'content.category.manage',
  ],
  // The responsible Consultation / Inquiry supervisor (Phase 13). An ACTIVE
  // assignment grants full responder + oversight rights for that domain ONLY —
  // a CONSULTATION supervisor cannot touch inquiries and vice-versa.
  CONSULTATION: [
    'consultation.read',
    'consultation.respond',
    'consultation.close',
    'consultation.admin.read',
  ],
  INQUIRY: ['inquiry.read', 'inquiry.respond', 'inquiry.close', 'inquiry.admin.read'],
  // The responsible Support supervisor ("مسؤول الدعم"): full responder +
  // oversight rights for "تواصل معنا" support messages ONLY.
  SUPPORT: ['support.read', 'support.respond', 'support.close', 'support.admin.read'],
  // The "authorized specialist supervisor" for the Veterinary Services
  // marketplace: reviews (approve / reject) service listings + pet-owner
  // requests. Does NOT gain access to the private deal conversations.
  VET_SERVICE: ['vet_service.read', 'vet_service.approve', 'vet_service.reject'],
  // The responsible Advertisement supervisor: full campaign + slide management
  // for every placement.
  ADVERTISEMENT: ['advertisement.manage'],
  // The responsible Market specialist: offer moderation + exchange-rate entry
  // (governorate-wide data, not per-organization — trader approve/reject/
  // suspend stays ADMIN/MODERATOR-oversight-only, not part of this domain).
  MARKET: ['market.offer.admin.read', 'market.offer.admin.delete', 'market.rate.manage'],
  // The responsible Pet Owners Store supervisor: full catalogue (products +
  // categories + images) and order management for the platform storefront.
  PET_OWNER_STORE: [
    'pet_store.product.manage',
    'pet_store.category.manage',
    'pet_store.order.manage',
  ],
  // The responsible Veterinarian Store supervisor: full catalogue (products +
  // categories + images) and order management for the Veterinarian-mode
  // platform storefront.
  VETERINARIAN_STORE: [
    'veterinarian_store.product.manage',
    'veterinarian_store.category.manage',
    'veterinarian_store.order.manage',
  ],
  // The responsible Veterinarian Jobs supervisor: reviews (approve / reject)
  // job offers + job-seeker profiles. Does NOT gain access to applications or
  // the private chat threads.
  VET_JOBS: ['vet_job.read', 'vet_job.approve', 'vet_job.reject'],
  // The responsible Veterinarian Courses & Seminars supervisor: reviews
  // (approve / reject) courses/seminars/workshops. Does NOT gain access to
  // per-course registrations beyond what `vet_course.read` exposes.
  VET_COURSES: ['vet_course.read', 'vet_course.approve', 'vet_course.reject'],
};

/**
 * Role → permission grants applied by the seed. ADMIN is intentionally empty:
 * it is granted full access centrally by the authorization override, so it does
 * not need (and should not accumulate) individual permission rows.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  ADMIN: [],
  MODERATOR: [
    'user.read',
    'role.read',
    'permission.read',
    'veterinarian.read',
    'supervisor.read',
    'audit.read',
    'organization.admin.read',
    'trader.admin.read',
  ],
  PET_OWNER: [],
  VETERINARIAN: [],
};

export function isRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function isSupervisorDomain(value: string): value is SupervisorDomain {
  return (SUPERVISOR_DOMAINS as readonly string[]).includes(value);
}
