import { Router } from 'express';
import type { Container } from '../container.js';
import { createHealthRouter } from '../modules/health/health.routes.js';
import { createAuthRouter } from '../modules/auth/auth.routes.js';
import { createAdminAuditRouter } from '../modules/audit/admin-audit.routes.js';
import { createAdminRbacRouter } from '../modules/rbac/admin-rbac.routes.js';
import { createAdminSupervisorRouter } from '../modules/supervisors/supervisor.routes.js';
import { createAdminUsersRouter } from '../modules/users/admin-users.routes.js';
import { createPublicUsersRouter } from '../modules/users/public-users.routes.js';
import { createSelfUsersRouter } from '../modules/users/self-users.routes.js';
import { createVeterinarianRouters } from '../modules/veterinarians/veterinarian.routes.js';
import { createOrganizationRouter } from '../modules/organizations/presentation/organization.routes.js';
import { createAdminOrganizationRouter } from '../modules/organizations/presentation/admin-organization.routes.js';
import { createAnimalRouter } from '../modules/animals/presentation/animal.routes.js';
import {
  createAdminAnimalPublicationRouter,
  createAnimalPublicationRouter,
  createPublicPublicationRouter,
} from '../modules/animals/index.js';
import {
  createClinicalVeterinaryRouter,
  createOwnerMedicalRouter,
} from '../modules/veterinary-care/index.js';
import { createFarmRouter } from '../modules/farms/index.js';
import { createVeterinaryStoreRouter } from '../modules/veterinary-store/index.js';
import {
  createChatRouter,
  createChatMessageRouter,
  createOrgChatRouter,
} from '../modules/chat/index.js';
import {
  createConsultationRouter,
  createInquiryRouter,
  createSupportAdminRouter,
} from '../modules/consultations/index.js';
import {
  createContentRouter,
  createContentCategoryRouter,
  createAdminContentRouter,
} from '../modules/content/index.js';
import { createHomeAdRouter, createAdminHomeAdRouter } from '../modules/homeAds/index.js';
import {
  createNotificationRouter,
  createAdminNotificationRouter,
} from '../modules/notifications/index.js';

/**
 * Root API router. Each feature module contributes its own sub-router here.
 * The version prefix (`/api/v1`) is applied where this is mounted in `app.ts`.
 */
export function createApiRouter(c: Container): Router {
  const router = Router();

  // --- infrastructure -------------------------------------------------
  router.use(createHealthRouter(c.db));

  // --- Phase 2: identity & authorization ----------------------------
  router.use('/auth', createAuthRouter(c));

  const vets = createVeterinarianRouters(c);
  const rbac = createAdminRbacRouter(c);

  router.use('/veterinarians', vets.self);

  // Self-service (`/users/me/*`) MUST be mounted before the public `/users/:id`
  // directory router below — otherwise `me` would be parsed as a `:id` uuid
  // param and rejected with 422 instead of reaching the self routes.
  router.use('/users', createSelfUsersRouter(c));

  // Authenticated user directory (name-level summary only) — resolves the
  // authorship / actor user ids other DTOs carry, and backs member/supervisor
  // pickers. The full account record stays under `/admin/users` (permissioned).
  router.use('/users', createPublicUsersRouter(c));

  // --- Phase 3: organizations -------------------------------------
  router.use('/organizations', createOrganizationRouter(c));

  // --- Phase 4: animals & ownership ------------------------------
  router.use('/animals', createAnimalRouter(c));

  // --- Phase 5: veterinary care & medical records ---------------
  // Clinic-facing routes extend `/organizations/:organizationId/...`; the
  // owner-facing read routes extend `/animals/:animalId/...`. Both are mounted
  // after their Phase 3/4 siblings so unmatched paths fall through to here.
  router.use('/organizations', createClinicalVeterinaryRouter(c));
  router.use('/animals', createOwnerMedicalRouter(c));

  // --- Phase 6: farms & poultry --------------------------------
  // Farm-ID join flow + poultry CRUD extend `/organizations/...`; the farm
  // organization itself (create / approve / members / supervisors) is Phase 3.
  router.use('/organizations', createFarmRouter(c));

  // --- Phase 7: animal lifecycle publications (Lost/Adoption/Mating) ---
  // Owner create/read extends `/animals/:animalId/publications`; the public
  // browse lives at `/animal-publications` (a literal `/animals/lost` segment
  // would be shadowed by Phase 4's `/animals/:animalId`).
  router.use('/animals', createAnimalPublicationRouter(c));
  router.use('/animal-publications', createPublicPublicationRouter(c));

  // --- Phase 10: veterinary store products --------------------
  // Product CRUD + inventory extend `/organizations/:organizationId/products`;
  // the store organization itself (create / approve / members) is Phase 3.
  router.use('/organizations', createVeterinaryStoreRouter(c));

  // --- Phase 12: chat & real-time messaging -------------------
  // `POST /organizations/:organizationId/conversations` starts a conversation;
  // conversations/messages are addressed by their own ids afterwards. The
  // WebSocket side (auth + `conversation:<id>` subscription) is wired in
  // `server.ts` via `createChatRealtime`.
  router.use('/organizations', createOrgChatRouter(c));
  router.use('/conversations', createChatRouter(c));
  router.use('/messages', createChatMessageRouter(c));

  // --- Phase 13: consultations & inquiries -------------------
  // Creator paths are authentication + eligibility only; RESPONDER access
  // (supervisor/admin) is decided in `SupportThreadService`. Realtime
  // (`consultation:<id>` / `inquiry:<id>`) is wired in `server.ts`.
  router.use('/consultations', createConsultationRouter(c));
  router.use('/inquiries', createInquiryRouter(c));

  // --- Phase 14: content management --------------------------
  // Public reads of PUBLISHED content; admin/supervisor management under
  // `/admin/content*`. Realtime `content:feed` wired in `server.ts`.
  router.use('/content', createContentRouter(c));
  router.use('/content-categories', createContentCategoryRouter(c));

  // --- Pet Owner Home: banner carousel ------------------------
  // Public reads for the Home screen; admin/supervisor management under
  // `/admin/home-ads*`.
  router.use('/home-ads', createHomeAdRouter(c));

  // --- Phase 15: notifications & FCM -------------------------
  // Personal notification inbox + device-token management (auth + ownership
  // only). Domain events → NotificationEventHandler (wired in the container).
  router.use('/notifications', createNotificationRouter(c));

  router.use('/admin/users', createAdminUsersRouter(c));
  router.use('/admin/roles', rbac.roles);
  router.use('/admin/permissions', rbac.permissions);
  router.use('/admin/veterinarians', vets.admin);
  router.use('/admin/supervisors', createAdminSupervisorRouter(c));
  router.use('/admin/organizations', createAdminOrganizationRouter(c));
  router.use('/admin/animal-publications', createAdminAnimalPublicationRouter(c));
  router.use('/admin', createSupportAdminRouter(c));
  router.use('/admin', createAdminContentRouter(c));
  router.use('/admin/home-ads', createAdminHomeAdRouter(c));
  router.use('/admin/notifications', createAdminNotificationRouter(c));
  router.use('/admin/audit-logs', createAdminAuditRouter(c));

  return router;
}
