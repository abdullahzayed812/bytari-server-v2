import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { createFarmSubscriptionMiddleware, withFarmOrganization } from '../../farms/presentation/farm.middleware.js';
import { CattleBatchController } from './cattle-batch.controller.js';
import { createCattleBatchMiddleware } from './cattle-batch.middleware.js';
import {
  batchParamSchema,
  createCattleBatchBodySchema,
  createCattleFarmBodySchema,
  listCattleBatchesQuerySchema,
  organizationParamSchema,
  updateCattleBatchBodySchema,
} from './cattle-batch.schemas.js';
import { CattleOpsController } from './cattle-ops.controller.js';
import {
  caseIdParamSchema,
  createCaseBodySchema,
  createDailyRecordBodySchema,
  createHealthEventBodySchema,
  healthEventIdParamSchema,
  imageUploadUrlBodySchema,
  listCasesQuerySchema,
  listDailyRecordsQuerySchema,
  listHealthEventsQuerySchema,
  recordIdParamSchema,
  registerImageBodySchema,
  updateCaseBodySchema,
  updateDailyRecordBodySchema,
  updateHealthEventBodySchema,
  weeklySummaryQuerySchema,
} from './cattle-ops.schemas.js';

/**
 * Cattle Farms routes — mirrors `server/src/modules/farms/presentation/
 * farm.routes.ts` (flock CRUD) + `poultry-ops.routes.ts` (daily records,
 * health events, cases) combined into one router, mounted at `/organizations`.
 * `farm/profile|expenses|appointments|subscription*` are NOT duplicated here —
 * a cattle farm reuses those exact routes from the poultry `farm`/`poultry-ops`
 * routers unchanged (they already operate at the farm-org level regardless of
 * species). Every route runs:
 *
 *   authenticate → validate → withOrganization → withFarmOrganization
 *     → requireActiveFarmSubscription → authorizeOrg('farm.cattle_batch.*'|'farm.*')
 *     → [withCattleBatch for batch-scoped] → controller
 */
export function createCattleBatchRouter(c: Container): Router {
  const batchCtrl = new CattleBatchController(c.cattleBatchService, c.organizationService);
  const opsCtrl = new CattleOpsController(
    c.cattleDailyRecordService,
    c.cattleHealthEventService,
    c.cattleCaseService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { requireActiveFarmSubscription } = createFarmSubscriptionMiddleware({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });
  const { withCattleBatch } = createCattleBatchMiddleware({ batches: c.cattleBatchRepository });

  const r = Router();
  r.use(c.authenticate);

  const orgOp = [withOrganization, withFarmOrganization, requireActiveFarmSubscription] as const;
  const batchOp = [withOrganization, withFarmOrganization, requireActiveFarmSubscription] as const;

  // --- "Add Cattle Farm" (domain-specific creation form) ------
  // Any ACTIVE user creates their own farm; the org is created PENDING and the
  // caller becomes its OWNER. No `authorizeOrg` — there is no organization yet.
  r.post(
    '/cattle-farms',
    validate({ body: createCattleFarmBodySchema }),
    asyncHandler(batchCtrl.createFarm),
  );

  // --- cattle batches --------------------------------------------
  const batchesBase = '/:organizationId/cattle/batches';
  r.get(
    batchesBase,
    validate({ params: organizationParamSchema, query: listCattleBatchesQuerySchema }),
    ...orgOp,
    authorizeOrg('farm.cattle_batch.read'),
    asyncHandler(batchCtrl.listBatches),
  );
  r.post(
    batchesBase,
    validate({ params: organizationParamSchema, body: createCattleBatchBodySchema }),
    ...orgOp,
    authorizeOrg('farm.cattle_batch.create'),
    asyncHandler(batchCtrl.createBatch),
  );
  r.get(
    `${batchesBase}/:batchId`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.cattle_batch.read'),
    withCattleBatch,
    asyncHandler(batchCtrl.getBatch),
  );
  r.patch(
    `${batchesBase}/:batchId`,
    validate({ params: batchParamSchema, body: updateCattleBatchBodySchema }),
    ...batchOp,
    authorizeOrg('farm.cattle_batch.update'),
    withCattleBatch,
    asyncHandler(batchCtrl.updateBatch),
  );
  r.delete(
    `${batchesBase}/:batchId`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.cattle_batch.delete'),
    withCattleBatch,
    asyncHandler(batchCtrl.deleteBatch),
  );

  // --- batch + weekly summary (server-computed) ------------------
  const batchBase = `${batchesBase}/:batchId`;
  r.get(
    `${batchBase}/summary`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.cattle_batch.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.batchSummary),
  );
  r.get(
    `${batchBase}/weekly-summary`,
    validate({ params: batchParamSchema, query: weeklySummaryQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.cattle_batch.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.weeklySummary),
  );

  // --- daily records ---------------------------------------
  const dailyBase = `${batchBase}/daily-records`;
  r.get(
    dailyBase,
    validate({ params: batchParamSchema, query: listDailyRecordsQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.listDailyRecords),
  );
  r.post(
    dailyBase,
    validate({ params: batchParamSchema, body: createDailyRecordBodySchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.create'),
    withCattleBatch,
    asyncHandler(opsCtrl.createDailyRecord),
  );
  r.get(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.getDailyRecord),
  );
  r.patch(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema, body: updateDailyRecordBodySchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.update'),
    withCattleBatch,
    asyncHandler(opsCtrl.updateDailyRecord),
  );
  r.delete(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.delete'),
    withCattleBatch,
    asyncHandler(opsCtrl.deleteDailyRecord),
  );

  // --- health events (treatments & vaccinations) ------------
  const healthBase = `${batchBase}/health-events`;
  r.get(
    healthBase,
    validate({ params: batchParamSchema, query: listHealthEventsQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.listHealthEvents),
  );
  r.post(
    healthBase,
    validate({ params: batchParamSchema, body: createHealthEventBodySchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.create'),
    withCattleBatch,
    asyncHandler(opsCtrl.createHealthEvent),
  );
  r.get(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.getHealthEvent),
  );
  r.patch(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema, body: updateHealthEventBodySchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.update'),
    withCattleBatch,
    asyncHandler(opsCtrl.updateHealthEvent),
  );
  r.delete(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.delete'),
    withCattleBatch,
    asyncHandler(opsCtrl.deleteHealthEvent),
  );

  // --- individual cases ----------------------------
  const caseBase = `${batchBase}/cases`;
  r.get(
    caseBase,
    validate({ params: batchParamSchema, query: listCasesQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.case.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.listCases),
  );
  r.get(
    `${caseBase}/summary`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.case.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.caseSummary),
  );
  r.post(
    caseBase,
    validate({ params: batchParamSchema, body: createCaseBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.create'),
    withCattleBatch,
    asyncHandler(opsCtrl.createCase),
  );
  r.get(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.case.read'),
    withCattleBatch,
    asyncHandler(opsCtrl.getCase),
  );
  r.patch(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema, body: updateCaseBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.update'),
    withCattleBatch,
    asyncHandler(opsCtrl.updateCase),
  );
  r.delete(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.case.delete'),
    withCattleBatch,
    asyncHandler(opsCtrl.deleteCase),
  );
  r.post(
    `${caseBase}/:caseId/image/upload-url`,
    validate({ params: caseIdParamSchema, body: imageUploadUrlBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.update'),
    withCattleBatch,
    asyncHandler(opsCtrl.requestCaseImageUploadUrl),
  );
  r.post(
    `${caseBase}/:caseId/image`,
    validate({ params: caseIdParamSchema, body: registerImageBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.update'),
    withCattleBatch,
    asyncHandler(opsCtrl.registerCaseImage),
  );

  return r;
}
