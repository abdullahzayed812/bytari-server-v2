import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { createFarmMiddleware, withFarmOrganization } from './farm.middleware.js';
import { PoultryOpsController } from './poultry-ops.controller.js';
import {
  appointmentIdParamSchema,
  caseIdParamSchema,
  createAppointmentBodySchema,
  createCaseBodySchema,
  createDailyRecordBodySchema,
  createExpenseBodySchema,
  createHealthEventBodySchema,
  expenseIdParamSchema,
  flockScopeParamSchema,
  healthEventIdParamSchema,
  imageUploadUrlBodySchema,
  listAppointmentsQuerySchema,
  listCasesQuerySchema,
  listDailyRecordsQuerySchema,
  listExpensesQuerySchema,
  listHealthEventsQuerySchema,
  organizationParamSchema,
  recordIdParamSchema,
  registerImageBodySchema,
  updateAppointmentBodySchema,
  updateCaseBodySchema,
  updateDailyRecordBodySchema,
  updateExpenseBodySchema,
  updateFarmProfileBodySchema,
  updateHealthEventBodySchema,
  weeklySummaryQuerySchema,
} from './poultry-ops.schemas.js';

/**
 * Poultry Farm operations routes — the Farm Details screen. Mounted at
 * `/organizations`, alongside the Phase 6 farm/poultry router. Every route runs:
 *
 *   authenticate → validate → withOrganization → withFarmOrganization (400 non-FARM)
 *     → authorizeOrg('farm.<x>') → [withPoultryFlock for flock-scoped] → controller
 *
 * so the caller must be an ACTIVE member of the FARM with the right organization
 * permission (ADMIN overrides `authorizeOrg`). Flock-scoped routes additionally
 * resolve `:flockId` scoped by `organization_id` (cross-farm 404).
 */
export function createPoultryOpsRouter(c: Container): Router {
  const ctrl = new PoultryOpsController(
    c.farmProfileService,
    c.poultryDailyRecordService,
    c.farmExpenseService,
    c.poultryHealthEventService,
    c.farmAppointmentService,
    c.poultryCaseService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withPoultryFlock } = createFarmMiddleware({ flocks: c.poultryFlockRepository });

  const r = Router();
  r.use(c.authenticate);

  const org = [withOrganization, withFarmOrganization] as const;
  const flock = [withOrganization, withFarmOrganization] as const;

  // --- farm profile (Farm Details header) --------------------------
  r.get(
    '/:organizationId/farm/profile',
    validate({ params: organizationParamSchema }),
    ...org,
    authorizeOrg('organization.read'),
    asyncHandler(ctrl.getProfile),
  );
  r.patch(
    '/:organizationId/farm/profile',
    validate({ params: organizationParamSchema, body: updateFarmProfileBodySchema }),
    ...org,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.updateProfile),
  );
  r.post(
    '/:organizationId/farm/profile/image/upload-url',
    validate({ params: organizationParamSchema, body: imageUploadUrlBodySchema }),
    ...org,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.requestProfileImageUploadUrl),
  );
  r.post(
    '/:organizationId/farm/profile/image',
    validate({ params: organizationParamSchema, body: registerImageBodySchema }),
    ...org,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.registerProfileImage),
  );

  // --- batch + weekly summary (server-computed) ------------------
  const flockBase = '/:organizationId/poultry/flocks/:flockId';
  r.get(
    `${flockBase}/summary`,
    validate({ params: flockScopeParamSchema }),
    ...flock,
    authorizeOrg('farm.poultry.read'),
    withPoultryFlock,
    asyncHandler(ctrl.batchSummary),
  );
  r.get(
    `${flockBase}/weekly-summary`,
    validate({ params: flockScopeParamSchema, query: weeklySummaryQuerySchema }),
    ...flock,
    authorizeOrg('farm.poultry.read'),
    withPoultryFlock,
    asyncHandler(ctrl.weeklySummary),
  );

  // --- daily records ---------------------------------------
  const dailyBase = `${flockBase}/daily-records`;
  r.get(
    dailyBase,
    validate({ params: flockScopeParamSchema, query: listDailyRecordsQuerySchema }),
    ...flock,
    authorizeOrg('farm.daily_record.read'),
    withPoultryFlock,
    asyncHandler(ctrl.listDailyRecords),
  );
  r.post(
    dailyBase,
    validate({ params: flockScopeParamSchema, body: createDailyRecordBodySchema }),
    ...flock,
    authorizeOrg('farm.daily_record.create'),
    withPoultryFlock,
    asyncHandler(ctrl.createDailyRecord),
  );
  r.get(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...flock,
    authorizeOrg('farm.daily_record.read'),
    withPoultryFlock,
    asyncHandler(ctrl.getDailyRecord),
  );
  r.patch(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema, body: updateDailyRecordBodySchema }),
    ...flock,
    authorizeOrg('farm.daily_record.update'),
    withPoultryFlock,
    asyncHandler(ctrl.updateDailyRecord),
  );
  r.delete(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...flock,
    authorizeOrg('farm.daily_record.delete'),
    withPoultryFlock,
    asyncHandler(ctrl.deleteDailyRecord),
  );

  // --- expenses -----------------------------------------
  const expenseBase = '/:organizationId/farm/expenses';
  r.get(
    expenseBase,
    validate({ params: organizationParamSchema, query: listExpensesQuerySchema }),
    ...org,
    authorizeOrg('farm.expense.read'),
    asyncHandler(ctrl.listExpenses),
  );
  r.get(
    `${expenseBase}/summary`,
    validate({ params: organizationParamSchema }),
    ...org,
    authorizeOrg('farm.expense.read'),
    asyncHandler(ctrl.expenseSummary),
  );
  r.post(
    expenseBase,
    validate({ params: organizationParamSchema, body: createExpenseBodySchema }),
    ...org,
    authorizeOrg('farm.expense.create'),
    asyncHandler(ctrl.createExpense),
  );
  r.get(
    `${expenseBase}/:expenseId`,
    validate({ params: expenseIdParamSchema }),
    ...org,
    authorizeOrg('farm.expense.read'),
    asyncHandler(ctrl.getExpense),
  );
  r.patch(
    `${expenseBase}/:expenseId`,
    validate({ params: expenseIdParamSchema, body: updateExpenseBodySchema }),
    ...org,
    authorizeOrg('farm.expense.update'),
    asyncHandler(ctrl.updateExpense),
  );
  r.delete(
    `${expenseBase}/:expenseId`,
    validate({ params: expenseIdParamSchema }),
    ...org,
    authorizeOrg('farm.expense.delete'),
    asyncHandler(ctrl.deleteExpense),
  );

  // --- health events (treatments & vaccinations) ------------
  const healthBase = `${flockBase}/health-events`;
  r.get(
    healthBase,
    validate({ params: flockScopeParamSchema, query: listHealthEventsQuerySchema }),
    ...flock,
    authorizeOrg('farm.health_event.read'),
    withPoultryFlock,
    asyncHandler(ctrl.listHealthEvents),
  );
  r.post(
    healthBase,
    validate({ params: flockScopeParamSchema, body: createHealthEventBodySchema }),
    ...flock,
    authorizeOrg('farm.health_event.create'),
    withPoultryFlock,
    asyncHandler(ctrl.createHealthEvent),
  );
  r.get(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...flock,
    authorizeOrg('farm.health_event.read'),
    withPoultryFlock,
    asyncHandler(ctrl.getHealthEvent),
  );
  r.patch(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema, body: updateHealthEventBodySchema }),
    ...flock,
    authorizeOrg('farm.health_event.update'),
    withPoultryFlock,
    asyncHandler(ctrl.updateHealthEvent),
  );
  r.delete(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...flock,
    authorizeOrg('farm.health_event.delete'),
    withPoultryFlock,
    asyncHandler(ctrl.deleteHealthEvent),
  );

  // --- appointments ----------------------------------
  const apptBase = '/:organizationId/farm/appointments';
  r.get(
    apptBase,
    validate({ params: organizationParamSchema, query: listAppointmentsQuerySchema }),
    ...org,
    authorizeOrg('farm.appointment.read'),
    asyncHandler(ctrl.listAppointments),
  );
  r.post(
    apptBase,
    validate({ params: organizationParamSchema, body: createAppointmentBodySchema }),
    ...org,
    authorizeOrg('farm.appointment.create'),
    asyncHandler(ctrl.createAppointment),
  );
  r.get(
    `${apptBase}/:appointmentId`,
    validate({ params: appointmentIdParamSchema }),
    ...org,
    authorizeOrg('farm.appointment.read'),
    asyncHandler(ctrl.getAppointment),
  );
  r.patch(
    `${apptBase}/:appointmentId`,
    validate({ params: appointmentIdParamSchema, body: updateAppointmentBodySchema }),
    ...org,
    authorizeOrg('farm.appointment.update'),
    asyncHandler(ctrl.updateAppointment),
  );
  r.delete(
    `${apptBase}/:appointmentId`,
    validate({ params: appointmentIdParamSchema }),
    ...org,
    authorizeOrg('farm.appointment.delete'),
    asyncHandler(ctrl.deleteAppointment),
  );

  // --- individual cases ----------------------------
  const caseBase = `${flockBase}/cases`;
  r.get(
    caseBase,
    validate({ params: flockScopeParamSchema, query: listCasesQuerySchema }),
    ...flock,
    authorizeOrg('farm.case.read'),
    withPoultryFlock,
    asyncHandler(ctrl.listCases),
  );
  r.get(
    `${caseBase}/summary`,
    validate({ params: flockScopeParamSchema }),
    ...flock,
    authorizeOrg('farm.case.read'),
    withPoultryFlock,
    asyncHandler(ctrl.caseSummary),
  );
  r.post(
    caseBase,
    validate({ params: flockScopeParamSchema, body: createCaseBodySchema }),
    ...flock,
    authorizeOrg('farm.case.create'),
    withPoultryFlock,
    asyncHandler(ctrl.createCase),
  );
  r.get(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...flock,
    authorizeOrg('farm.case.read'),
    withPoultryFlock,
    asyncHandler(ctrl.getCase),
  );
  r.patch(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema, body: updateCaseBodySchema }),
    ...flock,
    authorizeOrg('farm.case.update'),
    withPoultryFlock,
    asyncHandler(ctrl.updateCase),
  );
  r.delete(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...flock,
    authorizeOrg('farm.case.delete'),
    withPoultryFlock,
    asyncHandler(ctrl.deleteCase),
  );
  r.post(
    `${caseBase}/:caseId/image/upload-url`,
    validate({ params: caseIdParamSchema, body: imageUploadUrlBodySchema }),
    ...flock,
    authorizeOrg('farm.case.update'),
    withPoultryFlock,
    asyncHandler(ctrl.requestCaseImageUploadUrl),
  );
  r.post(
    `${caseBase}/:caseId/image`,
    validate({ params: caseIdParamSchema, body: registerImageBodySchema }),
    ...flock,
    authorizeOrg('farm.case.update'),
    withPoultryFlock,
    asyncHandler(ctrl.registerCaseImage),
  );

  return r;
}
