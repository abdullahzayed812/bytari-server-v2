import type { RequestHandler } from 'express';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { AppConfig } from './config/index.js';
import { InMemoryEventBus, type EventBus } from './shared/events/index.js';

import { AuditRepository } from './modules/audit/audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
import { PermissionRepository } from './modules/rbac/permission.repository.js';
import { RoleRepository } from './modules/rbac/role.repository.js';
import { RbacService } from './modules/rbac/rbac.service.js';
import { AuthorizationService } from './modules/authorization/authorization.service.js';
import {
  createAuthorizationMiddleware,
  type AuthorizationMiddleware,
} from './modules/authorization/authorization.middleware.js';
import { UserRepository } from './modules/users/user.repository.js';
import { UserService } from './modules/users/user.service.js';
import { RefreshSessionRepository } from './modules/auth/refresh-session.repository.js';
import { RefreshSessionService } from './modules/auth/refresh-session.service.js';
import { PasswordService } from './modules/auth/password.service.js';
import { TokenService } from './modules/auth/token.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { createAuthenticate } from './modules/auth/authenticate.middleware.js';
import { VeterinarianRepository } from './modules/veterinarians/veterinarian.repository.js';
import { VeterinarianDocumentRepository } from './modules/veterinarians/veterinarian-document.repository.js';
import { VeterinarianService } from './modules/veterinarians/veterinarian.service.js';
import { SupervisorRepository } from './modules/supervisors/supervisor.repository.js';
import { SupervisorService } from './modules/supervisors/supervisor.service.js';
import { OrganizationRepository } from './modules/organizations/infrastructure/organization.repository.js';
import { MembershipRepository } from './modules/organizations/infrastructure/membership.repository.js';
import { OrganizationRbacRepository } from './modules/organizations/infrastructure/organization-rbac.repository.js';
import { OrganizationFollowRepository } from './modules/organizations/infrastructure/organization-follow.repository.js';
import { OrganizationReviewRepository } from './modules/organizations/infrastructure/organization-review.repository.js';
import { OrganizationService } from './modules/organizations/application/organization.service.js';
import { MembershipService } from './modules/organizations/application/membership.service.js';
import { OrganizationSupervisorService } from './modules/organizations/application/organization-supervisor.service.js';
import { OrganizationEngagementService } from './modules/organizations/application/organization-engagement.service.js';
import { AnimalRepository } from './modules/animals/infrastructure/animal.repository.js';
import { AnimalOwnershipRepository } from './modules/animals/infrastructure/animal-ownership.repository.js';
import { AnimalPublicationRepository } from './modules/animals/infrastructure/animal-publication.repository.js';
import { PublicationInteractionRepository } from './modules/animals/infrastructure/publication-interaction.repository.js';
import { AnimalTransferRequestRepository } from './modules/animals/infrastructure/animal-transfer-request.repository.js';
import { AnimalService } from './modules/animals/application/animal.service.js';
import { AnimalOwnershipService } from './modules/animals/application/animal-ownership.service.js';
import { AnimalPublicationService } from './modules/animals/application/animal-publication.service.js';
import { PublicationInteractionService } from './modules/animals/application/publication-interaction.service.js';
import { AnimalTransferRequestService } from './modules/animals/application/animal-transfer-request.service.js';
import { AnimalClinicAccessRepository } from './modules/veterinary-care/infrastructure/animal-clinic-access.repository.js';
import { MedicalRecordRepository } from './modules/veterinary-care/infrastructure/medical-record.repository.js';
import { VaccinationRepository } from './modules/veterinary-care/infrastructure/vaccination.repository.js';
import { VeterinaryAccessService } from './modules/veterinary-care/application/veterinary-access.service.js';
import { MedicalRecordService } from './modules/veterinary-care/application/medical-record.service.js';
import { VaccinationService } from './modules/veterinary-care/application/vaccination.service.js';
import { MedicalHistoryService } from './modules/veterinary-care/application/medical-history.service.js';
import { FarmDetailsRepository } from './modules/farms/infrastructure/farm-details.repository.js';
import { PoultryFlockRepository } from './modules/farms/infrastructure/poultry-flock.repository.js';
import { FarmProfileRepository } from './modules/farms/infrastructure/farm-profile.repository.js';
import { FarmSubscriptionRenewalRepository } from './modules/farms/infrastructure/farm-subscription-renewal.repository.js';
import { PoultryDailyRecordRepository } from './modules/farms/infrastructure/poultry-daily-record.repository.js';
import { FarmExpenseRepository } from './modules/farms/infrastructure/farm-expense.repository.js';
import { PoultryHealthEventRepository } from './modules/farms/infrastructure/poultry-health-event.repository.js';
import { FarmAppointmentRepository } from './modules/farms/infrastructure/farm-appointment.repository.js';
import { PoultryCaseRepository } from './modules/farms/infrastructure/poultry-case.repository.js';
import { FarmJoinService } from './modules/farms/application/farm-join.service.js';
import { PoultryFlockService } from './modules/farms/application/poultry-flock.service.js';
import { FarmProfileService } from './modules/farms/application/farm-profile.service.js';
import { FarmSubscriptionService } from './modules/farms/application/farm-subscription.service.js';
import { PoultryDailyRecordService } from './modules/farms/application/poultry-daily-record.service.js';
import { FarmExpenseService } from './modules/farms/application/farm-expense.service.js';
import { PoultryHealthEventService } from './modules/farms/application/poultry-health-event.service.js';
import { FarmAppointmentService } from './modules/farms/application/farm-appointment.service.js';
import { PoultryCaseService } from './modules/farms/application/poultry-case.service.js';
import { SheepBatchRepository } from './modules/livestock/infrastructure/sheep-batch.repository.js';
import { SheepDailyRecordRepository } from './modules/livestock/infrastructure/sheep-daily-record.repository.js';
import { SheepHealthEventRepository } from './modules/livestock/infrastructure/sheep-health-event.repository.js';
import { SheepCaseRepository } from './modules/livestock/infrastructure/sheep-case.repository.js';
import { SheepBatchService } from './modules/livestock/application/sheep-batch.service.js';
import { SheepDailyRecordService } from './modules/livestock/application/sheep-daily-record.service.js';
import { SheepHealthEventService } from './modules/livestock/application/sheep-health-event.service.js';
import { SheepCaseService } from './modules/livestock/application/sheep-case.service.js';
import { CattleBatchRepository } from './modules/livestock/infrastructure/cattle-batch.repository.js';
import { CattleDailyRecordRepository } from './modules/livestock/infrastructure/cattle-daily-record.repository.js';
import { CattleHealthEventRepository } from './modules/livestock/infrastructure/cattle-health-event.repository.js';
import { CattleCaseRepository } from './modules/livestock/infrastructure/cattle-case.repository.js';
import { CattleBatchService } from './modules/livestock/application/cattle-batch.service.js';
import { CattleDailyRecordService } from './modules/livestock/application/cattle-daily-record.service.js';
import { CattleHealthEventService } from './modules/livestock/application/cattle-health-event.service.js';
import { CattleCaseService } from './modules/livestock/application/cattle-case.service.js';
import { ProductRepository } from './modules/veterinary-store/infrastructure/product.repository.js';
import { ProductService } from './modules/veterinary-store/application/product.service.js';
import { TraderRepository } from './modules/poultryMarket/infrastructure/trader.repository.js';
import { PoultryOfferRepository } from './modules/poultryMarket/infrastructure/poultry-offer.repository.js';
import { EggOfferRepository } from './modules/poultryMarket/infrastructure/egg-offer.repository.js';
import { ExchangeRateRepository } from './modules/poultryMarket/infrastructure/exchange-rate.repository.js';
import { PoultryMarketStatisticsRepository } from './modules/poultryMarket/infrastructure/poultry-market-statistics.repository.js';
import { TraderService } from './modules/poultryMarket/application/trader.service.js';
import { PoultryOfferService } from './modules/poultryMarket/application/poultry-offer.service.js';
import { EggOfferService } from './modules/poultryMarket/application/egg-offer.service.js';
import { ExchangeRateService } from './modules/poultryMarket/application/exchange-rate.service.js';
import { PoultryMarketStatisticsService } from './modules/poultryMarket/application/poultry-market-statistics.service.js';
import { ConversationRepository } from './modules/chat/infrastructure/conversation.repository.js';
import { MessageRepository } from './modules/chat/infrastructure/message.repository.js';
import { ChatService } from './modules/chat/application/chat.service.js';
import { ThreadRepository } from './modules/consultations/infrastructure/thread.repository.js';
import { AiSettingsRepository } from './modules/consultations/infrastructure/ai-settings.repository.js';
import { AiSettingsService } from './modules/consultations/application/ai-settings.service.js';
import { SupportThreadService } from './modules/consultations/application/support-thread.service.js';
import {
  CONSULTATION_CONFIG,
  INQUIRY_CONFIG,
} from './modules/consultations/application/thread.config.js';
import {
  NoopAiResponder,
  type AiResponderPort,
} from './modules/consultations/application/ai-responder.port.js';
import { createObjectStorage, type ObjectStorage } from './infra/storage/index.js';
import { ContentRepository } from './modules/content/infrastructure/content.repository.js';
import { ContentFileRepository } from './modules/content/infrastructure/content-file.repository.js';
import { CategoryRepository } from './modules/content/infrastructure/category.repository.js';
import { ContentService } from './modules/content/application/content.service.js';
import { CategoryService } from './modules/content/application/category.service.js';
import { TipRepository } from './modules/content/infrastructure/tip.repository.js';
import { TipEngagementRepository } from './modules/content/infrastructure/tip-engagement.repository.js';
import { TipService } from './modules/content/application/tip.service.js';
import {
  NewsRepository,
  NewsBookmarkRepository,
} from './modules/content/infrastructure/news.repository.js';
import { NewsService } from './modules/content/application/news.service.js';
import { AdCampaignRepository } from './modules/advertisements/infrastructure/ad-campaign.repository.js';
import { AdSlideRepository } from './modules/advertisements/infrastructure/ad-slide.repository.js';
import { AdvertisementService } from './modules/advertisements/application/advertisement.service.js';
import {
  createPushProvider,
  PushNotificationService,
  type PushNotificationProvider,
} from './infra/push/index.js';
import { createEmailProvider, EmailService, type EmailProvider } from './infra/email/index.js';
import { NotificationRepository } from './modules/notifications/infrastructure/notification.repository.js';
import { DeviceTokenRepository } from './modules/notifications/infrastructure/device-token.repository.js';
import { PreferenceRepository } from './modules/notifications/infrastructure/preference.repository.js';
import { NotificationPolicy } from './modules/notifications/domain/notification.policy.js';
import { NotificationService } from './modules/notifications/application/notification.service.js';
import { NotificationEventHandler } from './modules/notifications/application/notification-event-handler.js';

export interface ContainerDeps {
  db: Knex;
  config: AppConfig;
  logger: Logger;
  eventBus?: EventBus;
  /**
   * AI reply generator for consultations / inquiries. Phase 13 has no real
   * provider — defaults to {@link NoopAiResponder}. Tests inject a stub.
   */
  aiResponder?: AiResponderPort;
  /**
   * Object storage for content files (Phase 14). Defaults to the configured
   * implementation (Cloudflare R2, else in-memory). Tests inject an in-memory
   * instance so no real R2 credentials are needed.
   */
  objectStorage?: ObjectStorage;
  /**
   * Push provider for FCM (Phase 15). Defaults to the configured implementation
   * (Firebase when credentials are present, else a logging no-op). Tests inject
   * a fake so no real Firebase credentials are needed.
   */
  pushProvider?: PushNotificationProvider;
  /**
   * Outbound email provider. Defaults to the configured implementation (Gmail
   * SMTP when EMAIL_USER/EMAIL_PASS are present, else a logging no-op). Tests
   * inject a fake so no real mailbox is needed.
   */
  emailProvider?: EmailProvider;
}

/**
 * Composition root for the identity/authorization stack. Wires repositories →
 * services → middleware once, so routers receive fully-constructed collaborators
 * and stay declarative.
 */
export interface Container {
  db: Knex;
  config: AppConfig;
  logger: Logger;
  eventBus: EventBus;

  auditService: AuditService;
  userService: UserService;
  roleRepository: RoleRepository;
  rbacService: RbacService;
  authorizationService: AuthorizationService;
  passwordService: PasswordService;
  tokenService: TokenService;
  refreshSessionService: RefreshSessionService;
  authService: AuthService;
  veterinarianService: VeterinarianService;
  supervisorService: SupervisorService;

  organizationRepository: OrganizationRepository;
  membershipRepository: MembershipRepository;
  organizationRbacRepository: OrganizationRbacRepository;
  organizationFollowRepository: OrganizationFollowRepository;
  organizationReviewRepository: OrganizationReviewRepository;
  organizationService: OrganizationService;
  membershipService: MembershipService;
  organizationSupervisorService: OrganizationSupervisorService;
  organizationEngagementService: OrganizationEngagementService;

  animalRepository: AnimalRepository;
  animalOwnershipRepository: AnimalOwnershipRepository;
  animalPublicationRepository: AnimalPublicationRepository;
  publicationInteractionRepository: PublicationInteractionRepository;
  animalTransferRequestRepository: AnimalTransferRequestRepository;
  animalService: AnimalService;
  animalOwnershipService: AnimalOwnershipService;
  animalPublicationService: AnimalPublicationService;
  publicationInteractionService: PublicationInteractionService;
  animalTransferRequestService: AnimalTransferRequestService;

  animalClinicAccessRepository: AnimalClinicAccessRepository;
  medicalRecordRepository: MedicalRecordRepository;
  vaccinationRepository: VaccinationRepository;
  veterinaryAccessService: VeterinaryAccessService;
  medicalRecordService: MedicalRecordService;
  vaccinationService: VaccinationService;
  medicalHistoryService: MedicalHistoryService;

  farmDetailsRepository: FarmDetailsRepository;
  poultryFlockRepository: PoultryFlockRepository;
  farmProfileRepository: FarmProfileRepository;
  farmSubscriptionRenewalRepository: FarmSubscriptionRenewalRepository;
  poultryDailyRecordRepository: PoultryDailyRecordRepository;
  farmExpenseRepository: FarmExpenseRepository;
  poultryHealthEventRepository: PoultryHealthEventRepository;
  farmAppointmentRepository: FarmAppointmentRepository;
  poultryCaseRepository: PoultryCaseRepository;
  farmJoinService: FarmJoinService;
  poultryFlockService: PoultryFlockService;
  farmProfileService: FarmProfileService;
  farmSubscriptionService: FarmSubscriptionService;
  poultryDailyRecordService: PoultryDailyRecordService;
  farmExpenseService: FarmExpenseService;
  poultryHealthEventService: PoultryHealthEventService;
  farmAppointmentService: FarmAppointmentService;
  poultryCaseService: PoultryCaseService;

  sheepBatchRepository: SheepBatchRepository;
  sheepDailyRecordRepository: SheepDailyRecordRepository;
  sheepHealthEventRepository: SheepHealthEventRepository;
  sheepCaseRepository: SheepCaseRepository;
  sheepBatchService: SheepBatchService;
  sheepDailyRecordService: SheepDailyRecordService;
  sheepHealthEventService: SheepHealthEventService;
  sheepCaseService: SheepCaseService;

  cattleBatchRepository: CattleBatchRepository;
  cattleDailyRecordRepository: CattleDailyRecordRepository;
  cattleHealthEventRepository: CattleHealthEventRepository;
  cattleCaseRepository: CattleCaseRepository;
  cattleBatchService: CattleBatchService;
  cattleDailyRecordService: CattleDailyRecordService;
  cattleHealthEventService: CattleHealthEventService;
  cattleCaseService: CattleCaseService;

  productRepository: ProductRepository;
  productService: ProductService;

  traderRepository: TraderRepository;
  traderService: TraderService;
  poultryOfferRepository: PoultryOfferRepository;
  poultryOfferService: PoultryOfferService;
  eggOfferRepository: EggOfferRepository;
  eggOfferService: EggOfferService;
  exchangeRateRepository: ExchangeRateRepository;
  exchangeRateService: ExchangeRateService;
  poultryMarketStatisticsRepository: PoultryMarketStatisticsRepository;
  poultryMarketStatisticsService: PoultryMarketStatisticsService;

  conversationRepository: ConversationRepository;
  messageRepository: MessageRepository;
  chatService: ChatService;

  aiSettingsRepository: AiSettingsRepository;
  aiSettingsService: AiSettingsService;
  consultationRepository: ThreadRepository;
  inquiryRepository: ThreadRepository;
  consultationService: SupportThreadService;
  inquiryService: SupportThreadService;

  objectStorage: ObjectStorage;
  contentRepository: ContentRepository;
  contentFileRepository: ContentFileRepository;
  categoryRepository: CategoryRepository;
  contentService: ContentService;
  categoryService: CategoryService;
  tipRepository: TipRepository;
  tipEngagementRepository: TipEngagementRepository;
  tipService: TipService;
  newsRepository: NewsRepository;
  newsBookmarkRepository: NewsBookmarkRepository;
  newsService: NewsService;
  adCampaignRepository: AdCampaignRepository;
  adSlideRepository: AdSlideRepository;
  advertisementService: AdvertisementService;

  supervisorRepository: SupervisorRepository;
  pushProvider: PushNotificationProvider;
  pushNotificationService: PushNotificationService;
  emailProvider: EmailProvider;
  emailService: EmailService;
  deviceTokenRepository: DeviceTokenRepository;
  notificationRepository: NotificationRepository;
  preferenceRepository: PreferenceRepository;
  notificationPolicy: NotificationPolicy;
  notificationService: NotificationService;
  notificationEventHandler: NotificationEventHandler;

  /** `authenticate` middleware (verifies the access token, loads `req.auth`). */
  authenticate: RequestHandler;
  /** `authorize(permission)` / `requireApprovedVeterinarian()` guards. */
  authorization: AuthorizationMiddleware;
}

export function createContainer(deps: ContainerDeps): Container {
  const { db, config, logger } = deps;
  const eventBus = deps.eventBus ?? new InMemoryEventBus(logger);

  // --- audit ------------------------------------------------------------
  const auditService = new AuditService(new AuditRepository(db), logger);

  // --- rbac -----------------------------------------------------------
  const roleRepository = new RoleRepository(db);
  const permissionRepository = new PermissionRepository(db);
  const rbacService = new RbacService(
    db,
    roleRepository,
    permissionRepository,
    auditService,
    logger,
  );

  // --- organization RBAC repos (needed by AuthorizationService) -----
  const organizationRepository = new OrganizationRepository(db);
  const membershipRepository = new MembershipRepository(db);
  const organizationRbacRepository = new OrganizationRbacRepository(db);
  const supervisorRepository = new SupervisorRepository(db);

  const authorizationService = new AuthorizationService(
    roleRepository,
    permissionRepository,
    logger,
    { memberships: membershipRepository, orgRbac: organizationRbacRepository },
    supervisorRepository,
  );

  // --- auth primitives ----------------------------------------------
  const passwordService = new PasswordService(config.auth);
  const tokenService = new TokenService(config.auth, logger);
  const refreshSessionRepository = new RefreshSessionRepository(db);
  const refreshSessionService = new RefreshSessionService(
    db,
    refreshSessionRepository,
    tokenService,
    auditService,
    logger,
  );

  // --- object storage (hoisted: needed by UserService & VeterinarianService
  // for avatar / document presigned uploads, as well as the content module) --
  const objectStorage = deps.objectStorage ?? createObjectStorage(config, logger);

  // --- users -------------------------------------------------------
  const userRepository = new UserRepository(db);
  const userService = new UserService(
    db,
    userRepository,
    refreshSessionRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );

  // --- auth orchestration -----------------------------------------
  const authService = new AuthService(
    db,
    userService,
    passwordService,
    tokenService,
    refreshSessionService,
    roleRepository,
    auditService,
    logger,
  );

  // --- veterinarian workflow -----------------------------------
  const veterinarianService = new VeterinarianService(
    db,
    new VeterinarianRepository(db),
    new VeterinarianDocumentRepository(db),
    userService,
    roleRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );

  // --- system supervisors ------------------------------------
  const supervisorService = new SupervisorService(
    db,
    supervisorRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );

  // --- organizations (Phase 3) --------------------------------
  const organizationService = new OrganizationService(
    db,
    organizationRepository,
    membershipRepository,
    organizationRbacRepository,
    userService,
    auditService,
    eventBus,
    objectStorage,
    logger,
  );
  const membershipService = new MembershipService(
    db,
    membershipRepository,
    organizationRbacRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );
  const organizationSupervisorService = new OrganizationSupervisorService(
    db,
    membershipRepository,
    organizationRbacRepository,
    organizationRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );
  const organizationFollowRepository = new OrganizationFollowRepository(db);
  const organizationReviewRepository = new OrganizationReviewRepository(db);
  const organizationEngagementService = new OrganizationEngagementService(
    organizationRepository,
    organizationFollowRepository,
    organizationReviewRepository,
    logger,
  );

  // --- animals & ownership (Phase 4) --------------------------
  const animalRepository = new AnimalRepository(db);
  const animalOwnershipRepository = new AnimalOwnershipRepository(db);
  const animalService = new AnimalService(
    db,
    animalRepository,
    animalOwnershipRepository,
    auditService,
    eventBus,
    objectStorage,
    logger,
  );
  const animalOwnershipService = new AnimalOwnershipService(
    db,
    animalRepository,
    animalOwnershipRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );

  // --- animal lifecycle publications (Phase 7) ---------------
  const animalPublicationRepository = new AnimalPublicationRepository(db);
  const animalPublicationService = new AnimalPublicationService(
    db,
    animalPublicationRepository,
    auditService,
    eventBus,
    objectStorage,
    logger,
  );
  const publicationInteractionRepository = new PublicationInteractionRepository(db);
  const publicationInteractionService = new PublicationInteractionService(
    publicationInteractionRepository,
    animalPublicationService,
    eventBus,
    logger,
  );

  // --- animal ownership transfer requests (request/acceptance) -----
  const animalTransferRequestRepository = new AnimalTransferRequestRepository(db);
  const animalTransferRequestService = new AnimalTransferRequestService(
    db,
    animalTransferRequestRepository,
    animalOwnershipService,
    userService,
    auditService,
    eventBus,
    logger,
  );

  // --- veterinary care (Phase 5) -----------------------------
  const animalClinicAccessRepository = new AnimalClinicAccessRepository(db);
  const medicalRecordRepository = new MedicalRecordRepository(db);
  const vaccinationRepository = new VaccinationRepository(db);
  const veterinaryAccessService = new VeterinaryAccessService(
    db,
    animalClinicAccessRepository,
    animalRepository,
    auditService,
    eventBus,
    logger,
  );
  const medicalRecordService = new MedicalRecordService(
    db,
    medicalRecordRepository,
    animalRepository,
    auditService,
    eventBus,
    logger,
  );
  const vaccinationService = new VaccinationService(
    db,
    vaccinationRepository,
    animalRepository,
    auditService,
    eventBus,
    logger,
  );
  // Phase 8 — composed read-only medical history (records + vaccinations).
  const medicalHistoryService = new MedicalHistoryService(
    medicalRecordRepository,
    vaccinationRepository,
    logger,
  );

  // --- farms & poultry (Phase 6) ----------------------------
  const farmDetailsRepository = new FarmDetailsRepository(db);
  const poultryFlockRepository = new PoultryFlockRepository(db);
  const farmJoinService = new FarmJoinService(
    db,
    farmDetailsRepository,
    organizationRepository,
    membershipRepository,
    organizationRbacRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );
  const poultryFlockService = new PoultryFlockService(
    db,
    poultryFlockRepository,
    auditService,
    eventBus,
    logger,
  );

  const farmProfileRepository = new FarmProfileRepository(db);
  const farmSubscriptionRenewalRepository = new FarmSubscriptionRenewalRepository(db);
  const poultryDailyRecordRepository = new PoultryDailyRecordRepository(db);
  const farmExpenseRepository = new FarmExpenseRepository(db);
  const poultryHealthEventRepository = new PoultryHealthEventRepository(db);
  const farmAppointmentRepository = new FarmAppointmentRepository(db);
  const poultryCaseRepository = new PoultryCaseRepository(db);
  const farmProfileService = new FarmProfileService(
    db,
    farmProfileRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );
  const farmSubscriptionService = new FarmSubscriptionService(
    db,
    farmSubscriptionRenewalRepository,
    auditService,
    eventBus,
    logger,
  );
  const poultryDailyRecordService = new PoultryDailyRecordService(
    db,
    poultryDailyRecordRepository,
    poultryFlockRepository,
    farmExpenseRepository,
    auditService,
    eventBus,
    logger,
  );
  const farmExpenseService = new FarmExpenseService(
    db,
    farmExpenseRepository,
    auditService,
    eventBus,
    logger,
  );
  const poultryHealthEventService = new PoultryHealthEventService(
    db,
    poultryHealthEventRepository,
    poultryFlockRepository,
    auditService,
    eventBus,
    logger,
  );
  const farmAppointmentService = new FarmAppointmentService(
    db,
    farmAppointmentRepository,
    auditService,
    eventBus,
    logger,
  );
  const poultryCaseService = new PoultryCaseService(
    db,
    poultryCaseRepository,
    poultryFlockRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );

  // --- Sheep Farms & Cattle Farms -----------------------------
  const sheepBatchRepository = new SheepBatchRepository(db);
  const sheepDailyRecordRepository = new SheepDailyRecordRepository(db);
  const sheepHealthEventRepository = new SheepHealthEventRepository(db);
  const sheepCaseRepository = new SheepCaseRepository(db);
  const sheepBatchService = new SheepBatchService(
    db,
    sheepBatchRepository,
    auditService,
    eventBus,
    logger,
  );
  const sheepDailyRecordService = new SheepDailyRecordService(
    db,
    sheepDailyRecordRepository,
    sheepBatchRepository,
    farmExpenseRepository,
    auditService,
    eventBus,
    logger,
  );
  const sheepHealthEventService = new SheepHealthEventService(
    db,
    sheepHealthEventRepository,
    sheepBatchRepository,
    auditService,
    eventBus,
    logger,
  );
  const sheepCaseService = new SheepCaseService(
    db,
    sheepCaseRepository,
    sheepBatchRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );

  const cattleBatchRepository = new CattleBatchRepository(db);
  const cattleDailyRecordRepository = new CattleDailyRecordRepository(db);
  const cattleHealthEventRepository = new CattleHealthEventRepository(db);
  const cattleCaseRepository = new CattleCaseRepository(db);
  const cattleBatchService = new CattleBatchService(
    db,
    cattleBatchRepository,
    auditService,
    eventBus,
    logger,
  );
  const cattleDailyRecordService = new CattleDailyRecordService(
    db,
    cattleDailyRecordRepository,
    cattleBatchRepository,
    farmExpenseRepository,
    auditService,
    eventBus,
    logger,
  );
  const cattleHealthEventService = new CattleHealthEventService(
    db,
    cattleHealthEventRepository,
    cattleBatchRepository,
    auditService,
    eventBus,
    logger,
  );
  const cattleCaseService = new CattleCaseService(
    db,
    cattleCaseRepository,
    cattleBatchRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );

  // --- veterinary store & products (Phase 10) ----------------
  const productRepository = new ProductRepository(db);
  const productService = new ProductService(db, productRepository, auditService, eventBus, logger);

  // --- Poultry Markets (trader registration / offers / exchange rates) ---
  const traderRepository = new TraderRepository(db);
  const traderService = new TraderService(
    db,
    traderRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );
  const poultryOfferRepository = new PoultryOfferRepository(db);
  const poultryOfferService = new PoultryOfferService(
    db,
    poultryOfferRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );
  const eggOfferRepository = new EggOfferRepository(db);
  const eggOfferService = new EggOfferService(
    db,
    eggOfferRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );
  const exchangeRateRepository = new ExchangeRateRepository(db);
  const exchangeRateService = new ExchangeRateService(
    db,
    exchangeRateRepository,
    auditService,
    eventBus,
    logger,
  );
  const poultryMarketStatisticsRepository = new PoultryMarketStatisticsRepository(db);
  const poultryMarketStatisticsService = new PoultryMarketStatisticsService(poultryMarketStatisticsRepository, logger);

  // --- chat & real-time messaging (Phase 12) -----------------
  const conversationRepository = new ConversationRepository(db);
  const messageRepository = new MessageRepository(db);
  const chatService = new ChatService(
    db,
    conversationRepository,
    messageRepository,
    membershipRepository,
    organizationRepository,
    userService,
    auditService,
    eventBus,
    logger,
  );

  // --- consultations & inquiries (Phase 13) ------------------
  const aiSettingsRepository = new AiSettingsRepository(db);
  const aiSettingsService = new AiSettingsService(
    db,
    aiSettingsRepository,
    auditService,
    eventBus,
    logger,
  );
  const aiResponder: AiResponderPort = deps.aiResponder ?? new NoopAiResponder();
  const consultationRepository = new ThreadRepository(db, {
    threadTable: 'consultations',
    messageTable: 'consultation_messages',
    hasAnimal: true,
  });
  const inquiryRepository = new ThreadRepository(db, {
    threadTable: 'inquiries',
    messageTable: 'inquiry_messages',
    hasAnimal: false,
  });
  const consultationService = new SupportThreadService(
    db,
    CONSULTATION_CONFIG,
    consultationRepository,
    aiSettingsService,
    aiResponder,
    authorizationService,
    auditService,
    eventBus,
    animalOwnershipRepository,
    logger,
  );
  const inquiryService = new SupportThreadService(
    db,
    INQUIRY_CONFIG,
    inquiryRepository,
    aiSettingsService,
    aiResponder,
    authorizationService,
    auditService,
    eventBus,
    animalOwnershipRepository,
    logger,
  );

  // --- content management (Phase 14) ------------------------
  // `objectStorage` was hoisted above (needed earlier by UserService / VeterinarianService).
  const contentRepository = new ContentRepository(db);
  const contentFileRepository = new ContentFileRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const contentService = new ContentService(
    db,
    contentRepository,
    contentFileRepository,
    categoryRepository,
    objectStorage,
    auditService,
    eventBus,
    logger,
  );
  const categoryService = new CategoryService(
    db,
    categoryRepository,
    auditService,
    eventBus,
    logger,
  );
  const tipRepository = new TipRepository(db);
  const tipEngagementRepository = new TipEngagementRepository(db);
  const tipService = new TipService(
    db,
    tipRepository,
    tipEngagementRepository,
    categoryRepository,
    objectStorage,
    auditService,
    logger,
  );
  const newsRepository = new NewsRepository(db);
  const newsBookmarkRepository = new NewsBookmarkRepository(db);
  const newsService = new NewsService(
    db,
    newsRepository,
    newsBookmarkRepository,
    categoryRepository,
    objectStorage,
    auditService,
    logger,
  );

  // --- advertisements (multi-section campaigns + ordered slides) ---
  const adCampaignRepository = new AdCampaignRepository(db);
  const adSlideRepository = new AdSlideRepository(db);
  const advertisementService = new AdvertisementService(
    db,
    adCampaignRepository,
    adSlideRepository,
    objectStorage,
    auditService,
    logger,
  );

  // --- notifications & FCM (Phase 15) -----------------------
  // Reuses the Phase-1 push infrastructure (provider abstraction + Firebase
  // adapter + PushNotificationService). Domain modules stay Firebase-unaware:
  // events → NotificationEventHandler → NotificationService → in-app row (+ FCM).
  const pushProvider: PushNotificationProvider =
    deps.pushProvider ?? createPushProvider(config, logger);
  const emailProvider: EmailProvider = deps.emailProvider ?? createEmailProvider(config, logger);
  const emailService = new EmailService(emailProvider, logger);
  const deviceTokenRepository = new DeviceTokenRepository(db);
  const pushNotificationService = new PushNotificationService(
    pushProvider,
    deviceTokenRepository,
    logger,
  );
  const notificationRepository = new NotificationRepository(db);
  const preferenceRepository = new PreferenceRepository(db);
  const notificationService = new NotificationService(
    db,
    notificationRepository,
    deviceTokenRepository,
    preferenceRepository,
    pushNotificationService,
    userService,
    auditService,
    eventBus,
    logger,
  );
  const notificationPolicy = new NotificationPolicy({
    conversations: conversationRepository,
    consultations: consultationRepository,
    inquiries: inquiryRepository,
    memberships: membershipRepository,
    organizations: organizationRepository,
    supervisors: supervisorRepository,
  });
  const notificationEventHandler = new NotificationEventHandler(
    eventBus,
    notificationPolicy,
    notificationService,
    logger,
  );
  notificationEventHandler.start();

  const authenticate = createAuthenticate({
    tokens: tokenService,
    users: userService,
    roles: roleRepository,
  });
  const authorization = createAuthorizationMiddleware(authorizationService);

  return {
    db,
    config,
    logger,
    eventBus,
    auditService,
    userService,
    roleRepository,
    rbacService,
    authorizationService,
    passwordService,
    tokenService,
    refreshSessionService,
    authService,
    veterinarianService,
    supervisorService,
    organizationRepository,
    membershipRepository,
    organizationRbacRepository,
    organizationFollowRepository,
    organizationReviewRepository,
    organizationService,
    membershipService,
    organizationSupervisorService,
    organizationEngagementService,
    animalRepository,
    animalOwnershipRepository,
    animalPublicationRepository,
    publicationInteractionRepository,
    animalTransferRequestRepository,
    animalService,
    animalOwnershipService,
    animalPublicationService,
    publicationInteractionService,
    animalTransferRequestService,
    animalClinicAccessRepository,
    medicalRecordRepository,
    vaccinationRepository,
    veterinaryAccessService,
    medicalRecordService,
    vaccinationService,
    medicalHistoryService,
    farmDetailsRepository,
    poultryFlockRepository,
    farmProfileRepository,
    farmSubscriptionRenewalRepository,
    poultryDailyRecordRepository,
    farmExpenseRepository,
    poultryHealthEventRepository,
    farmAppointmentRepository,
    poultryCaseRepository,
    farmJoinService,
    poultryFlockService,
    farmProfileService,
    farmSubscriptionService,
    poultryDailyRecordService,
    farmExpenseService,
    poultryHealthEventService,
    farmAppointmentService,
    poultryCaseService,
    sheepBatchRepository,
    sheepDailyRecordRepository,
    sheepHealthEventRepository,
    sheepCaseRepository,
    sheepBatchService,
    sheepDailyRecordService,
    sheepHealthEventService,
    sheepCaseService,
    cattleBatchRepository,
    cattleDailyRecordRepository,
    cattleHealthEventRepository,
    cattleCaseRepository,
    cattleBatchService,
    cattleDailyRecordService,
    cattleHealthEventService,
    cattleCaseService,
    productRepository,
    productService,
    traderRepository,
    traderService,
    poultryOfferRepository,
    poultryOfferService,
    eggOfferRepository,
    eggOfferService,
    exchangeRateRepository,
    exchangeRateService,
    poultryMarketStatisticsRepository,
    poultryMarketStatisticsService,
    conversationRepository,
    messageRepository,
    chatService,
    aiSettingsRepository,
    aiSettingsService,
    consultationRepository,
    inquiryRepository,
    consultationService,
    inquiryService,
    objectStorage,
    contentRepository,
    contentFileRepository,
    categoryRepository,
    contentService,
    categoryService,
    tipRepository,
    tipEngagementRepository,
    tipService,
    newsRepository,
    newsBookmarkRepository,
    newsService,
    adCampaignRepository,
    adSlideRepository,
    advertisementService,
    supervisorRepository,
    pushProvider,
    pushNotificationService,
    emailProvider,
    emailService,
    deviceTokenRepository,
    notificationRepository,
    preferenceRepository,
    notificationPolicy,
    notificationService,
    notificationEventHandler,
    authenticate,
    authorization,
  };
}
