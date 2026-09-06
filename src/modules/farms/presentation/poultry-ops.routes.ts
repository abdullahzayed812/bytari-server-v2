import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { createFarmSubscriptionMiddleware, withFarmOrganization } from './farm.middleware.js';
import { createPoultryFlockMiddleware } from './poultry-flock.middleware.js';
import {
  approveRenewalBodySchema,
  createRenewalRequestBodySchema,
  listRenewalRequestsQuerySchema,
  rejectRenewalBodySchema,
  renewalRequestParamSchema,
  setSubscriptionBodySchema,
} from './farm-subscription.schemas.js';
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
    c.farmSubscriptionService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { requireActiveFarmSubscription } = createFarmSubscriptionMiddleware({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });
  const { withPoultryFlock } = createPoultryFlockMiddleware({
    flocks: c.poultryFlockRepository,
  });

  const r = Router();
  r.use(c.authenticate);

  // `org`/`flock` stay ungated — used ONLY by the farm-profile GET and the
  // subscription/renewal routes, which must work precisely while the
  // subscription is not active. Every other route below requires an ACTIVE
  // subscription (`orgOp`/`flockOp`) — spec: no farm operation while
  // EXPIRED/NOT_STARTED.
  const org = [withOrganization, withFarmOrganization] as const;
  const orgOp = [withOrganization, withFarmOrganization, requireActiveFarmSubscription] as const;
  const flockOp = [withOrganization, withFarmOrganization, requireActiveFarmSubscription] as const;

  // --- farm profile (Farm Details header) --------------------------
  r.get(
    '/:organizationId/farm/profile',
    validate({ params: organizationParamSchema }),
    ...org,
    // The farm owner must be able to view their own farm's profile even
    // while it's PENDING approval, or once EXPIRED — see
    // organization.middleware.ts. Read-only; no subscription gate.
    authorizeOrg('organization.read', { allowInactiveForOwner: true }),
    asyncHandler(ctrl.getProfile),
  );
  r.patch(
    '/:organizationId/farm/profile',
    validate({ params: organizationParamSchema, body: updateFarmProfileBodySchema }),
    ...orgOp,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.updateProfile),
  );
  r.post(
    '/:organizationId/farm/profile/image/upload-url',
    validate({ params: organizationParamSchema, body: imageUploadUrlBodySchema }),
    ...orgOp,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.requestProfileImageUploadUrl),
  );
  r.post(
    '/:organizationId/farm/profile/image',
    validate({ params: organizationParamSchema, body: registerImageBodySchema }),
    ...orgOp,
    authorizeOrg('organization.update'),
    asyncHandler(ctrl.registerProfileImage),
  );

  // --- batch + weekly summary (server-computed) ------------------
  const flockBase = '/:organizationId/poultry/flocks/:flockId';
  r.get(
    `${flockBase}/summary`,
    validate({ params: flockScopeParamSchema }),
    ...flockOp,
    authorizeOrg('farm.poultry.read'),
    withPoultryFlock,
    asyncHandler(ctrl.batchSummary),
  );
  r.get(
    `${flockBase}/weekly-summary`,
    validate({ params: flockScopeParamSchema, query: weeklySummaryQuerySchema }),
    ...flockOp,
    authorizeOrg('farm.poultry.read'),
    withPoultryFlock,
    asyncHandler(ctrl.weeklySummary),
  );

  // --- daily records ---------------------------------------
  const dailyBase = `${flockBase}/daily-records`;
  r.get(
    dailyBase,
    validate({ params: flockScopeParamSchema, query: listDailyRecordsQuerySchema }),
    ...flockOp,
    authorizeOrg('farm.daily_record.read'),
    withPoultryFlock,
    asyncHandler(ctrl.listDailyRecords),
  );
  r.post(
    dailyBase,
    validate({ params: flockScopeParamSchema, body: createDailyRecordBodySchema }),
    ...flockOp,
    authorizeOrg('farm.daily_record.create'),
    withPoultryFlock,
    asyncHandler(ctrl.createDailyRecord),
  );
  r.get(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...flockOp,
    authorizeOrg('farm.daily_record.read'),
    withPoultryFlock,
    asyncHandler(ctrl.getDailyRecord),
  );
  r.patch(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema, body: updateDailyRecordBodySchema }),
    ...flockOp,
    authorizeOrg('farm.daily_record.update'),
    withPoultryFlock,
    asyncHandler(ctrl.updateDailyRecord),
  );
  r.delete(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...flockOp,
    authorizeOrg('farm.daily_record.delete'),
    withPoultryFlock,
    asyncHandler(ctrl.deleteDailyRecord),
  );

  // --- expenses -----------------------------------------
  const expenseBase = '/:organizationId/farm/expenses';
  r.get(
    expenseBase,
    validate({ params: organizationParamSchema, query: listExpensesQuerySchema }),
    ...orgOp,
    authorizeOrg('farm.expense.read'),
    asyncHandler(ctrl.listExpenses),
  );
  r.get(
    `${expenseBase}/summary`,
    validate({ params: organizationParamSchema }),
    ...orgOp,
    authorizeOrg('farm.expense.read'),
    asyncHandler(ctrl.expenseSummary),
  );
  r.post(
    expenseBase,
    validate({ params: organizationParamSchema, body: createExpenseBodySchema }),
    ...orgOp,
    authorizeOrg('farm.expense.create'),
    asyncHandler(ctrl.createExpense),
  );
  r.get(
    `${expenseBase}/:expenseId`,
    validate({ params: expenseIdParamSchema }),
    ...orgOp,
    authorizeOrg('farm.expense.read'),
    asyncHandler(ctrl.getExpense),
  );
  r.patch(
    `${expenseBase}/:expenseId`,
    validate({ params: expenseIdParamSchema, body: updateExpenseBodySchema }),
    ...orgOp,
    authorizeOrg('farm.expense.update'),
    asyncHandler(ctrl.updateExpense),
  );
  r.delete(
    `${expenseBase}/:expenseId`,
    validate({ params: expenseIdParamSchema }),
    ...orgOp,
    authorizeOrg('farm.expense.delete'),
    asyncHandler(ctrl.deleteExpense),
  );

  // --- health events (treatments & vaccinations) ------------
  const healthBase = `${flockBase}/health-events`;
  r.get(
    healthBase,
    validate({ params: flockScopeParamSchema, query: listHealthEventsQuerySchema }),
    ...flockOp,
    authorizeOrg('farm.health_event.read'),
    withPoultryFlock,
    asyncHandler(ctrl.listHealthEvents),
  );
  r.post(
    healthBase,
    validate({ params: flockScopeParamSchema, body: createHealthEventBodySchema }),
    ...flockOp,
    authorizeOrg('farm.health_event.create'),
    withPoultryFlock,
    asyncHandler(ctrl.createHealthEvent),
  );
  r.get(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...flockOp,
    authorizeOrg('farm.health_event.read'),
    withPoultryFlock,
    asyncHandler(ctrl.getHealthEvent),
  );
  r.patch(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema, body: updateHealthEventBodySchema }),
    ...flockOp,
    authorizeOrg('farm.health_event.update'),
    withPoultryFlock,
    asyncHandler(ctrl.updateHealthEvent),
  );
  r.delete(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...flockOp,
    authorizeOrg('farm.health_event.delete'),
    withPoultryFlock,
    asyncHandler(ctrl.deleteHealthEvent),
  );

  // --- appointments ----------------------------------
  const apptBase = '/:organizationId/farm/appointments';
  r.get(
    apptBase,
    validate({ params: organizationParamSchema, query: listAppointmentsQuerySchema }),
    ...orgOp,
    authorizeOrg('farm.appointment.read'),
    asyncHandler(ctrl.listAppointments),
  );
  r.post(
    apptBase,
    validate({ params: organizationParamSchema, body: createAppointmentBodySchema }),
    ...orgOp,
    authorizeOrg('farm.appointment.create'),
    asyncHandler(ctrl.createAppointment),
  );
  r.get(
    `${apptBase}/:appointmentId`,
    validate({ params: appointmentIdParamSchema }),
    ...orgOp,
    authorizeOrg('farm.appointment.read'),
    asyncHandler(ctrl.getAppointment),
  );
  r.patch(
    `${apptBase}/:appointmentId`,
    validate({ params: appointmentIdParamSchema, body: updateAppointmentBodySchema }),
    ...orgOp,
    authorizeOrg('farm.appointment.update'),
    asyncHandler(ctrl.updateAppointment),
  );
  r.delete(
    `${apptBase}/:appointmentId`,
    validate({ params: appointmentIdParamSchema }),
    ...orgOp,
    authorizeOrg('farm.appointment.delete'),
    asyncHandler(ctrl.deleteAppointment),
  );

  // --- individual cases ----------------------------
  const caseBase = `${flockBase}/cases`;
  r.get(
    caseBase,
    validate({ params: flockScopeParamSchema, query: listCasesQuerySchema }),
    ...flockOp,
    authorizeOrg('farm.case.read'),
    withPoultryFlock,
    asyncHandler(ctrl.listCases),
  );
  r.get(
    `${caseBase}/summary`,
    validate({ params: flockScopeParamSchema }),
    ...flockOp,
    authorizeOrg('farm.case.read'),
    withPoultryFlock,
    asyncHandler(ctrl.caseSummary),
  );
  r.post(
    caseBase,
    validate({ params: flockScopeParamSchema, body: createCaseBodySchema }),
    ...flockOp,
    authorizeOrg('farm.case.create'),
    withPoultryFlock,
    asyncHandler(ctrl.createCase),
  );
  r.get(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...flockOp,
    authorizeOrg('farm.case.read'),
    withPoultryFlock,
    asyncHandler(ctrl.getCase),
  );
  r.patch(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema, body: updateCaseBodySchema }),
    ...flockOp,
    authorizeOrg('farm.case.update'),
    withPoultryFlock,
    asyncHandler(ctrl.updateCase),
  );
  r.delete(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...flockOp,
    authorizeOrg('farm.case.delete'),
    withPoultryFlock,
    asyncHandler(ctrl.deleteCase),
  );
  r.post(
    `${caseBase}/:caseId/image/upload-url`,
    validate({ params: caseIdParamSchema, body: imageUploadUrlBodySchema }),
    ...flockOp,
    authorizeOrg('farm.case.update'),
    withPoultryFlock,
    asyncHandler(ctrl.requestCaseImageUploadUrl),
  );
  r.post(
    `${caseBase}/:caseId/image`,
    validate({ params: caseIdParamSchema, body: registerImageBodySchema }),
    ...flockOp,
    authorizeOrg('farm.case.update'),
    withPoultryFlock,
    asyncHandler(ctrl.registerCaseImage),
  );

  // --- subscription (owner / assigned supervisor / admin) ------------
  // Deliberately NOT subscription-gated — these are exactly the routes that
  // must keep working while the subscription is EXPIRED/NOT_STARTED (reading
  // status, requesting renewal, and the admin/supervisor actions that fix it).
  const subscriptionBase = '/:organizationId/farm/subscription-renewals';
  r.get(
    subscriptionBase,
    validate({ params: organizationParamSchema, query: listRenewalRequestsQuerySchema }),
    ...org,
    authorizeOrg('farm.subscription.read', { allowInactiveForOwner: true }),
    asyncHandler(ctrl.listSubscriptionRenewals),
  );
  r.post(
    subscriptionBase,
    validate({ params: organizationParamSchema, body: createRenewalRequestBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.read', { allowInactiveForOwner: true }),
    asyncHandler(ctrl.createSubscriptionRenewal),
  );
  // `excludeOwner: true` — the subscription period is Admin/Supervisor
  // territory by design (spec §4/§9): the farm owner must never be able to
  // grant themselves a subscription, even though the OWNER override would
  // otherwise satisfy any org-scoped permission check.
  r.post(
    '/:organizationId/farm/subscription',
    validate({ params: organizationParamSchema, body: setSubscriptionBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.manage', { excludeOwner: true }),
    asyncHandler(ctrl.setSubscription),
  );
  r.post(
    `${subscriptionBase}/:requestId/approve`,
    validate({ params: renewalRequestParamSchema, body: approveRenewalBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.manage', { excludeOwner: true }),
    asyncHandler(ctrl.approveSubscriptionRenewal),
  );
  r.post(
    `${subscriptionBase}/:requestId/reject`,
    validate({ params: renewalRequestParamSchema, body: rejectRenewalBodySchema }),
    ...org,
    authorizeOrg('farm.subscription.manage', { excludeOwner: true }),
    asyncHandler(ctrl.rejectSubscriptionRenewal),
  );

  return r;
}
