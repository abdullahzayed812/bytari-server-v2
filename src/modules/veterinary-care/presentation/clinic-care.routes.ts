import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  animalIdParamSchema,
  createAnimalMiddleware,
} from '../../animals/presentation/animal.middleware.js';
import {
  createOrganizationMiddleware,
  organizationIdParamSchema,
  requireOrganization,
} from '../../organizations/presentation/organization.middleware.js';
import { createOrganizationSubscriptionGuard } from '../../organizations/presentation/organization-subscription.middleware.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import { ClinicCareController } from './clinic-care.controller.js';
import { createVeterinaryCareMiddleware } from './veterinary-care.middleware.js';
import {
  clinicAnimalParamSchema,
  createQuickReviewTemplateBodySchema,
  createReminderBodySchema,
  listClinicRemindersQuerySchema,
  listClinicVaccinationsQuerySchema,
  listRemindersQuerySchema,
  medicalAttachmentUploadUrlBodySchema,
  ownerReminderParamSchema,
  quickReviewTemplateParamSchema,
  reminderParamSchema,
  updateQuickReviewTemplateBodySchema,
  updateReminderBodySchema,
  vaccinationParamSchema,
} from './veterinary-care.schemas.js';

/** MUST run after `withOrganization` — non-CLINIC organizations get 400 ORGANIZATION_TYPE_NOT_SUPPORTED. */
const withClinic: RequestHandler = asyncHandler((req, _res, next) => {
  VeterinaryCarePolicy.assertVeterinaryOrgType(requireOrganization(req));
  next();
});

/**
 * Legacy-parity clinic care, mounted at `/organizations`. Same chain as the
 * Phase 5 medical routes — membership + org permission, then (per-animal
 * routes) the clinic's ACTIVE veterinary-access grant:
 *
 *   authenticate → withOrganization → CLINIC → authorizeOrg(<perm>)
 *                → withVeterinaryAnimalAccess
 *
 * Reminders reuse the `medical_record.*` permissions (they are part of the
 * medical workflow); templates are clinic settings (`organization.update` to
 * manage, `medical_record.read` to use).
 */
export function createClinicCareRouter(c: Container): Router {
  const ctrl = new ClinicCareController(
    c.medicalRecordService,
    c.vaccinationService,
    c.animalReminderService,
    c.quickReviewTemplateService,
    c.clinicDashboardService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withVeterinaryAnimalAccess } = createVeterinaryCareMiddleware({
    animals: c.animalRepository,
    access: c.veterinaryAccessService,
    authz: c.authorizationService,
  });
  const activeSubscription = createOrganizationSubscriptionGuard({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });
  // Every clinic-care route also requires the clinic to be operational (not
  // pending — authorizeOrg — and not expired — activeSubscription).
  const org = (permission: string): RequestHandler[] => [
    withOrganization,
    withClinic,
    authorizeOrg(permission),
    activeSubscription,
  ];
  const animal = (permission: string): RequestHandler[] => [
    ...org(permission),
    withVeterinaryAnimalAccess,
  ];

  const r = Router();
  r.use(c.authenticate);

  // --- medical attachments (prescription photo / files) ---------------
  r.post(
    '/:organizationId/animals/:animalId/medical-records/attachments/upload-url',
    validate({ params: clinicAnimalParamSchema, body: medicalAttachmentUploadUrlBodySchema }),
    ...animal('medical_record.create'),
    asyncHandler(ctrl.attachmentUploadUrl),
  );

  // --- clinic-wide vaccinations ("التطعيمات") ---------------------------
  r.get(
    '/:organizationId/clinic-vaccinations',
    validate({ params: organizationIdParamSchema, query: listClinicVaccinationsQuerySchema }),
    ...org('vaccination.read'),
    asyncHandler(ctrl.listClinicVaccinations),
  );
  r.post(
    '/:organizationId/animals/:animalId/vaccinations/:vaccinationId/notify',
    validate({ params: vaccinationParamSchema }),
    ...animal('vaccination.update'),
    asyncHandler(ctrl.notifyVaccination),
  );

  // --- reminders ("التذكيرات") ----------------------------------------
  const remindersBase = '/:organizationId/animals/:animalId/reminders';
  r.get(
    remindersBase,
    validate({ params: clinicAnimalParamSchema, query: listRemindersQuerySchema }),
    ...animal('medical_record.read'),
    asyncHandler(ctrl.listReminders),
  );
  r.post(
    remindersBase,
    validate({ params: clinicAnimalParamSchema, body: createReminderBodySchema }),
    ...animal('medical_record.create'),
    asyncHandler(ctrl.createReminder),
  );
  r.get(
    `${remindersBase}/:reminderId`,
    validate({ params: reminderParamSchema }),
    ...animal('medical_record.read'),
    asyncHandler(ctrl.getReminder),
  );
  r.patch(
    `${remindersBase}/:reminderId`,
    validate({ params: reminderParamSchema, body: updateReminderBodySchema }),
    ...animal('medical_record.update'),
    asyncHandler(ctrl.updateReminder),
  );
  r.delete(
    `${remindersBase}/:reminderId`,
    validate({ params: reminderParamSchema }),
    ...animal('medical_record.delete'),
    asyncHandler(ctrl.deleteReminder),
  );
  r.post(
    `${remindersBase}/:reminderId/notify`,
    validate({ params: reminderParamSchema }),
    ...animal('medical_record.update'),
    asyncHandler(ctrl.notifyReminder),
  );
  r.get(
    '/:organizationId/clinic-reminders',
    validate({ params: organizationIdParamSchema, query: listClinicRemindersQuerySchema }),
    ...org('medical_record.read'),
    asyncHandler(ctrl.listClinicReminders),
  );
  r.post(
    '/:organizationId/clinic-reminders/notify-today',
    validate({ params: organizationIdParamSchema }),
    ...org('medical_record.update'),
    asyncHandler(ctrl.notifyTodayReminders),
  );

  // --- quick-review templates ("إعدادات المراجعة السريعة") --------------
  r.get(
    '/:organizationId/quick-review-templates',
    validate({ params: organizationIdParamSchema }),
    ...org('medical_record.read'),
    asyncHandler(ctrl.listTemplates),
  );
  r.post(
    '/:organizationId/quick-review-templates',
    validate({ params: organizationIdParamSchema, body: createQuickReviewTemplateBodySchema }),
    ...org('organization.update'),
    asyncHandler(ctrl.createTemplate),
  );
  r.patch(
    '/:organizationId/quick-review-templates/:templateId',
    validate({ params: quickReviewTemplateParamSchema, body: updateQuickReviewTemplateBodySchema }),
    ...org('organization.update'),
    asyncHandler(ctrl.updateTemplate),
  );
  r.delete(
    '/:organizationId/quick-review-templates/:templateId',
    validate({ params: quickReviewTemplateParamSchema }),
    ...org('organization.update'),
    asyncHandler(ctrl.deleteTemplate),
  );

  return r;
}

/**
 * Owner-facing additions, mounted at `/animals`: reminders (read + delete, as
 * in the legacy app) and the "العيادات" tab. Current owner or ADMIN only —
 * anyone else gets 404 from the animals module's ownership guard.
 */
export function createOwnerClinicCareRouter(c: Container): Router {
  const ctrl = new ClinicCareController(
    c.medicalRecordService,
    c.vaccinationService,
    c.animalReminderService,
    c.quickReviewTemplateService,
    c.clinicDashboardService,
  );
  const { withAnimal, authorizeAnimalRead, authorizeAnimalWrite } = createAnimalMiddleware({
    animals: c.animalService,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/:animalId/reminders',
    validate({ params: animalIdParamSchema, query: listRemindersQuerySchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.ownerListReminders),
  );
  r.delete(
    '/:animalId/reminders/:reminderId',
    validate({ params: ownerReminderParamSchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.ownerDeleteReminder),
  );
  r.get(
    '/:animalId/clinics',
    validate({ params: animalIdParamSchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.ownerListClinics),
  );

  return r;
}
