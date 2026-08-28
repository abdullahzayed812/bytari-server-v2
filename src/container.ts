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
import { VeterinarianService } from './modules/veterinarians/veterinarian.service.js';
import { SupervisorRepository } from './modules/supervisors/supervisor.repository.js';
import { SupervisorService } from './modules/supervisors/supervisor.service.js';
import { OrganizationRepository } from './modules/organizations/infrastructure/organization.repository.js';
import { MembershipRepository } from './modules/organizations/infrastructure/membership.repository.js';
import { OrganizationRbacRepository } from './modules/organizations/infrastructure/organization-rbac.repository.js';
import { OrganizationService } from './modules/organizations/application/organization.service.js';
import { MembershipService } from './modules/organizations/application/membership.service.js';
import { OrganizationSupervisorService } from './modules/organizations/application/organization-supervisor.service.js';
import { AnimalRepository } from './modules/animals/infrastructure/animal.repository.js';
import { AnimalOwnershipRepository } from './modules/animals/infrastructure/animal-ownership.repository.js';
import { AnimalPublicationRepository } from './modules/animals/infrastructure/animal-publication.repository.js';
import { AnimalService } from './modules/animals/application/animal.service.js';
import { AnimalOwnershipService } from './modules/animals/application/animal-ownership.service.js';
import { AnimalPublicationService } from './modules/animals/application/animal-publication.service.js';
import { AnimalClinicAccessRepository } from './modules/veterinary-care/infrastructure/animal-clinic-access.repository.js';
import { MedicalRecordRepository } from './modules/veterinary-care/infrastructure/medical-record.repository.js';
import { VaccinationRepository } from './modules/veterinary-care/infrastructure/vaccination.repository.js';
import { VeterinaryAccessService } from './modules/veterinary-care/application/veterinary-access.service.js';
import { MedicalRecordService } from './modules/veterinary-care/application/medical-record.service.js';
import { VaccinationService } from './modules/veterinary-care/application/vaccination.service.js';
import { MedicalHistoryService } from './modules/veterinary-care/application/medical-history.service.js';
import { FarmDetailsRepository } from './modules/farms/infrastructure/farm-details.repository.js';
import { PoultryFlockRepository } from './modules/farms/infrastructure/poultry-flock.repository.js';
import { FarmJoinService } from './modules/farms/application/farm-join.service.js';
import { PoultryFlockService } from './modules/farms/application/poultry-flock.service.js';
import { ProductRepository } from './modules/veterinary-store/infrastructure/product.repository.js';
import { ProductService } from './modules/veterinary-store/application/product.service.js';
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
import {
  createPushProvider,
  PushNotificationService,
  type PushNotificationProvider,
} from './infra/push/index.js';
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
  organizationService: OrganizationService;
  membershipService: MembershipService;
  organizationSupervisorService: OrganizationSupervisorService;

  animalRepository: AnimalRepository;
  animalOwnershipRepository: AnimalOwnershipRepository;
  animalPublicationRepository: AnimalPublicationRepository;
  animalService: AnimalService;
  animalOwnershipService: AnimalOwnershipService;
  animalPublicationService: AnimalPublicationService;

  animalClinicAccessRepository: AnimalClinicAccessRepository;
  medicalRecordRepository: MedicalRecordRepository;
  vaccinationRepository: VaccinationRepository;
  veterinaryAccessService: VeterinaryAccessService;
  medicalRecordService: MedicalRecordService;
  vaccinationService: VaccinationService;
  medicalHistoryService: MedicalHistoryService;

  farmDetailsRepository: FarmDetailsRepository;
  poultryFlockRepository: PoultryFlockRepository;
  farmJoinService: FarmJoinService;
  poultryFlockService: PoultryFlockService;

  productRepository: ProductRepository;
  productService: ProductService;

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

  supervisorRepository: SupervisorRepository;
  pushProvider: PushNotificationProvider;
  pushNotificationService: PushNotificationService;
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

  // --- users -------------------------------------------------------
  const userRepository = new UserRepository(db);
  const userService = new UserService(
    db,
    userRepository,
    refreshSessionRepository,
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
    userService,
    roleRepository,
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

  // --- animals & ownership (Phase 4) --------------------------
  const animalRepository = new AnimalRepository(db);
  const animalOwnershipRepository = new AnimalOwnershipRepository(db);
  const animalService = new AnimalService(
    db,
    animalRepository,
    animalOwnershipRepository,
    auditService,
    eventBus,
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

  // --- veterinary store & products (Phase 10) ----------------
  const productRepository = new ProductRepository(db);
  const productService = new ProductService(db, productRepository, auditService, eventBus, logger);

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
  const objectStorage = deps.objectStorage ?? createObjectStorage(config, logger);
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

  // --- notifications & FCM (Phase 15) -----------------------
  // Reuses the Phase-1 push infrastructure (provider abstraction + Firebase
  // adapter + PushNotificationService). Domain modules stay Firebase-unaware:
  // events → NotificationEventHandler → NotificationService → in-app row (+ FCM).
  const pushProvider: PushNotificationProvider =
    deps.pushProvider ?? createPushProvider(config, logger);
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
    organizationService,
    membershipService,
    organizationSupervisorService,
    animalRepository,
    animalOwnershipRepository,
    animalPublicationRepository,
    animalService,
    animalOwnershipService,
    animalPublicationService,
    animalClinicAccessRepository,
    medicalRecordRepository,
    vaccinationRepository,
    veterinaryAccessService,
    medicalRecordService,
    vaccinationService,
    medicalHistoryService,
    farmDetailsRepository,
    poultryFlockRepository,
    farmJoinService,
    poultryFlockService,
    productRepository,
    productService,
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
    supervisorRepository,
    pushProvider,
    pushNotificationService,
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
