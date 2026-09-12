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
import {
  createAnimalRouter,
  createAdminAnimalRouter,
} from '../modules/animals/presentation/animal.routes.js';
import {
  createAdminAnimalPublicationRouter,
  createAnimalPublicationRouter,
  createAnimalTransferRequestRouter,
  createPublicPublicationRouter,
  createTransferRequestRouter,
} from '../modules/animals/index.js';
import {
  createClinicalVeterinaryRouter,
  createOwnerMedicalRouter,
} from '../modules/veterinary-care/index.js';
import {
  createClinicAppointmentRouter,
  createOrgClinicAppointmentRouter,
} from '../modules/clinic-appointments/index.js';
import { createFarmRouter, createPoultryOpsRouter } from '../modules/farms/index.js';
import { createSheepBatchRouter, createCattleBatchRouter } from '../modules/livestock/index.js';
import {
  createPublicVeterinaryStoreProductRouter,
  createVeterinaryStoreProductRouter,
} from '../modules/veterinary-store/index.js';
import {
  createPublicVeterinaryOfficeProductRouter,
  createVeterinaryOfficeProductRouter,
} from '../modules/veterinary-office/index.js';
import {
  createPetOwnerStoreRouter,
  createAdminPetOwnerStoreRouter,
} from '../modules/pet-owner-store/index.js';
import {
  createVeterinarianStoreRouter,
  createAdminVeterinarianStoreRouter,
} from '../modules/veterinarian-store/index.js';
import {
  createTraderRouters,
  createPoultryOfferRouters,
  createEggOfferRouters,
  createExchangeRateRouter,
  createPoultryMarketStatisticsRouter,
} from '../modules/poultryMarket/index.js';
import {
  createChatRouter,
  createChatMessageRouter,
  createOrgChatRouter,
} from '../modules/chat/index.js';
import {
  createConsultationRouter,
  createInquiryRouter,
  createSupportMessageRouter,
  createSupportAdminRouter,
} from '../modules/consultations/index.js';
import {
  createVetServiceRouter,
  createAdminVetServiceRouter,
} from '../modules/vet-services/index.js';
import {
  createContentRouter,
  createContentCategoryRouter,
  createAdminContentRouter,
  createTipRouter,
  createAdminTipRouter,
  createNewsRouter,
  createAdminNewsRouter,
} from '../modules/content/index.js';
import { createPublicAdRouter, createAdminAdRouter } from '../modules/advertisements/index.js';
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

  // --- Animal ownership transfer requests (request/acceptance) --
  // Create extends `/animals/:animalId/transfer-requests`; "my requests"
  // (sent/received) + accept/reject/cancel live at `/animal-transfer-requests`
  // (a literal `/animals/sent` segment would be shadowed by `/animals/:animalId`).
  router.use('/animals', createAnimalTransferRequestRouter(c));
  router.use('/animal-transfer-requests', createTransferRequestRouter(c));

  // --- Phase 5: veterinary care & medical records ---------------
  // Clinic-facing routes extend `/organizations/:organizationId/...`; the
  // owner-facing read routes extend `/animals/:animalId/...`. Both are mounted
  // after their Phase 3/4 siblings so unmatched paths fall through to here.
  router.use('/organizations', createClinicalVeterinaryRouter(c));
  router.use('/animals', createOwnerMedicalRouter(c));

  // --- Clinic appointments: Pet Owner ↔ Clinic booking ---------
  // `POST /organizations/:organizationId/clinic-appointments` books a visit
  // (authentication + pet ownership only). The Pet Owner's own list / details /
  // cancel / reschedule-response live at `/clinic-appointments`. The clinic
  // (future Clinic Dashboard) reads and decides under
  // `/organizations/:organizationId/clinic-appointments*` (org-permissioned).
  router.use('/organizations', createOrgClinicAppointmentRouter(c));
  router.use('/clinic-appointments', createClinicAppointmentRouter(c));

  // --- Phase 6: farms & poultry --------------------------------
  // Farm-ID join flow + poultry CRUD extend `/organizations/...`; the farm
  // organization itself (create / approve / members / supervisors) is Phase 3.
  router.use('/organizations', createFarmRouter(c));

  // Poultry Farm operations (Farm Details screen): daily records + weekly/batch
  // summaries, expenses, treatments & vaccinations, appointments, cases, and the
  // farm-profile header. Extends `/organizations/:organizationId/...`.
  router.use('/organizations', createPoultryOpsRouter(c));

  // Sheep Farms & Cattle Farms — mirrors the Phase 6 farm/poultry routes above
  // for two more species. `farm/profile|expenses|appointments|subscription*`
  // are NOT duplicated — both reuse the poultry routers' routes unchanged.
  router.use('/organizations', createSheepBatchRouter(c));
  router.use('/organizations', createCattleBatchRouter(c));

  // --- Phase 7: animal lifecycle publications (Lost/Adoption/Mating) ---
  // Owner create/read extends `/animals/:animalId/publications`; the public
  // browse lives at `/animal-publications` (a literal `/animals/lost` segment
  // would be shadowed by Phase 4's `/animals/:animalId`).
  router.use('/animals', createAnimalPublicationRouter(c));
  router.use('/animal-publications', createPublicPublicationRouter(c));

  // --- Phase 10: veterinary store products --------------------
  // Product CRUD + inventory extend `/organizations/:organizationId/products`;
  // the store organization itself (create / approve / members) is Phase 3.
  router.use('/organizations', createVeterinaryStoreProductRouter(c));
  router.use('/organizations', createPublicVeterinaryStoreProductRouter(c));
  router.use('/organizations', createVeterinaryOfficeProductRouter(c));
  router.use('/organizations', createPublicVeterinaryOfficeProductRouter(c));

  // --- Pet Owners Store: platform-run consumer storefront ----
  // Dedicated `pet_owner_store_*` tables. Consumer browse / cart / checkout /
  // order history need only authentication; management lives under
  // `/admin/pet-owner-store` (permissioned).
  router.use('/pet-owner-store', createPetOwnerStoreRouter(c));

  // --- Veterinarian Store: platform-run consumer storefront for
  // Veterinarian-mode users ----
  // Dedicated `veterinarian_store_*` tables, completely separate from Pet
  // Owners Store and from the org-scoped Veterinary Store / Veterinary Office
  // catalogues. Consumer browse / cart / checkout / order history need only
  // authentication; management lives under `/admin/veterinarian-store`
  // (permissioned).
  router.use('/veterinarian-store', createVeterinarianStoreRouter(c));

  // --- Poultry Markets: trader registration / offers / exchange rates ---
  // Trader status is a per-USER concept, not per-organization — every route
  // here is mounted at the top level, no `:organizationId` in any path.
  const traders = createTraderRouters(c);
  const poultryOffers = createPoultryOfferRouters(c);
  const eggOffers = createEggOfferRouters(c);
  router.use('/traders', traders.self);
  router.use('/poultry-offers', poultryOffers.self);
  router.use('/egg-offers', eggOffers.self);
  router.use('/poultry-market/exchange-rates', createExchangeRateRouter(c));
  router.use('/poultry-market/statistics', createPoultryMarketStatisticsRouter(c));

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
  // "تواصل معنا" — any signed-in user sends a support message to the
  // administration (no recipient); ADMIN or a SUPPORT system-supervisor replies.
  router.use('/support-messages', createSupportMessageRouter(c));

  // --- Veterinary Services marketplace ("الخدمات") ----------
  // Vet-published service listings + pet-owner service requests (both moderated:
  // PENDING → APPROVED / REJECTED), offers / listing-requests, and the
  // PET_OWNER_VETERINARIAN deal conversations (chat module, extended additively).
  router.use('/vet-services', createVetServiceRouter(c));

  // --- Phase 14: content management --------------------------
  // Public reads of PUBLISHED content; admin/supervisor management under
  // `/admin/content*`. Realtime `content:feed` wired in `server.ts`.
  router.use('/content', createContentRouter(c));
  router.use('/content-categories', createContentCategoryRouter(c));
  // "Tips" — structured care advice inside the content module.
  router.use('/tips', createTipRouter(c));
  // "News" (آخر الأخبار) — a general news type inside the content module.
  router.use('/news', createNewsRouter(c));

  // --- Advertisements: multi-section campaigns ----------------
  // Public feed `GET /ads?placement=…` for any authenticated user; admin /
  // supervisor management under `/admin/ads*`.
  router.use('/ads', createPublicAdRouter(c));

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
  router.use('/admin/traders', traders.admin);
  router.use('/admin/poultry-offers', poultryOffers.admin);
  router.use('/admin/egg-offers', eggOffers.admin);
  router.use('/admin/animal-publications', createAdminAnimalPublicationRouter(c));
  router.use('/admin', createAdminVetServiceRouter(c));
  router.use('/admin/animals', createAdminAnimalRouter(c));
  router.use('/admin', createSupportAdminRouter(c));
  router.use('/admin', createAdminContentRouter(c));
  router.use('/admin/tips', createAdminTipRouter(c));
  router.use('/admin/news', createAdminNewsRouter(c));
  router.use('/admin/ads', createAdminAdRouter(c));
  router.use('/admin/pet-owner-store', createAdminPetOwnerStoreRouter(c));
  router.use('/admin/veterinarian-store', createAdminVeterinarianStoreRouter(c));
  router.use('/admin/notifications', createAdminNotificationRouter(c));
  router.use('/admin/audit-logs', createAdminAuditRouter(c));

  return router;
}
