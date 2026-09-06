import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { createFarmSubscriptionMiddleware, withFarmOrganization } from '../../farms/presentation/farm.middleware.js';
import { SheepBatchController } from './sheep-batch.controller.js';
import { createSheepBatchMiddleware } from './sheep-batch.middleware.js';
import {
  batchParamSchema,
  createSheepBatchBodySchema,
  createSheepFarmBodySchema,
  listSheepBatchesQuerySchema,
  organizationParamSchema,
  updateSheepBatchBodySchema,
} from './sheep-batch.schemas.js';
import { SheepOpsController } from './sheep-ops.controller.js';
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
} from './sheep-ops.schemas.js';

/**
 * Sheep Farms routes — mirrors `server/src/modules/farms/presentation/
 * farm.routes.ts` (flock CRUD) + `poultry-ops.routes.ts` (daily records,
 * health events, cases) combined into one router, mounted at `/organizations`.
 * `farm/profile|expenses|appointments|subscription*` are NOT duplicated here —
 * a sheep farm reuses those exact routes from the poultry `farm`/`poultry-ops`
 * routers unchanged (they already operate at the farm-org level regardless of
 * species). Every route runs:
 *
 *   authenticate → validate → withOrganization → withFarmOrganization
 *     → requireActiveFarmSubscription → authorizeOrg('farm.sheep_batch.*'|'farm.*')
 *     → [withSheepBatch for batch-scoped] → controller
 */
export function createSheepBatchRouter(c: Container): Router {
  const batchCtrl = new SheepBatchController(c.sheepBatchService, c.organizationService);
  const opsCtrl = new SheepOpsController(
    c.sheepDailyRecordService,
    c.sheepHealthEventService,
    c.sheepCaseService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { requireActiveFarmSubscription } = createFarmSubscriptionMiddleware({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });
  const { withSheepBatch } = createSheepBatchMiddleware({ batches: c.sheepBatchRepository });

  const r = Router();
  r.use(c.authenticate);

  const orgOp = [withOrganization, withFarmOrganization, requireActiveFarmSubscription] as const;
  const batchOp = [withOrganization, withFarmOrganization, requireActiveFarmSubscription] as const;

  // --- "Add Sheep Farm" (domain-specific creation form) ------
  // Any ACTIVE user creates their own farm; the org is created PENDING and the
  // caller becomes its OWNER. No `authorizeOrg` — there is no organization yet.
  r.post(
    '/sheep-farms',
    validate({ body: createSheepFarmBodySchema }),
    asyncHandler(batchCtrl.createFarm),
  );

  // --- sheep batches --------------------------------------------
  const batchesBase = '/:organizationId/sheep/batches';
  r.get(
    batchesBase,
    validate({ params: organizationParamSchema, query: listSheepBatchesQuerySchema }),
    ...orgOp,
    authorizeOrg('farm.sheep_batch.read'),
    asyncHandler(batchCtrl.listBatches),
  );
  r.post(
    batchesBase,
    validate({ params: organizationParamSchema, body: createSheepBatchBodySchema }),
    ...orgOp,
    authorizeOrg('farm.sheep_batch.create'),
    asyncHandler(batchCtrl.createBatch),
  );
  r.get(
    `${batchesBase}/:batchId`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.sheep_batch.read'),
    withSheepBatch,
    asyncHandler(batchCtrl.getBatch),
  );
  r.patch(
    `${batchesBase}/:batchId`,
    validate({ params: batchParamSchema, body: updateSheepBatchBodySchema }),
    ...batchOp,
    authorizeOrg('farm.sheep_batch.update'),
    withSheepBatch,
    asyncHandler(batchCtrl.updateBatch),
  );
  r.delete(
    `${batchesBase}/:batchId`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.sheep_batch.delete'),
    withSheepBatch,
    asyncHandler(batchCtrl.deleteBatch),
  );

  // --- batch + weekly summary (server-computed) ------------------
  const batchBase = `${batchesBase}/:batchId`;
  r.get(
    `${batchBase}/summary`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.sheep_batch.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.batchSummary),
  );
  r.get(
    `${batchBase}/weekly-summary`,
    validate({ params: batchParamSchema, query: weeklySummaryQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.sheep_batch.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.weeklySummary),
  );

  // --- daily records ---------------------------------------
  const dailyBase = `${batchBase}/daily-records`;
  r.get(
    dailyBase,
    validate({ params: batchParamSchema, query: listDailyRecordsQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.listDailyRecords),
  );
  r.post(
    dailyBase,
    validate({ params: batchParamSchema, body: createDailyRecordBodySchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.create'),
    withSheepBatch,
    asyncHandler(opsCtrl.createDailyRecord),
  );
  r.get(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.getDailyRecord),
  );
  r.patch(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema, body: updateDailyRecordBodySchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.update'),
    withSheepBatch,
    asyncHandler(opsCtrl.updateDailyRecord),
  );
  r.delete(
    `${dailyBase}/:recordId`,
    validate({ params: recordIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.daily_record.delete'),
    withSheepBatch,
    asyncHandler(opsCtrl.deleteDailyRecord),
  );

  // --- health events (treatments & vaccinations) ------------
  const healthBase = `${batchBase}/health-events`;
  r.get(
    healthBase,
    validate({ params: batchParamSchema, query: listHealthEventsQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.listHealthEvents),
  );
  r.post(
    healthBase,
    validate({ params: batchParamSchema, body: createHealthEventBodySchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.create'),
    withSheepBatch,
    asyncHandler(opsCtrl.createHealthEvent),
  );
  r.get(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.getHealthEvent),
  );
  r.patch(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema, body: updateHealthEventBodySchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.update'),
    withSheepBatch,
    asyncHandler(opsCtrl.updateHealthEvent),
  );
  r.delete(
    `${healthBase}/:eventId`,
    validate({ params: healthEventIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.health_event.delete'),
    withSheepBatch,
    asyncHandler(opsCtrl.deleteHealthEvent),
  );

  // --- individual cases ----------------------------
  const caseBase = `${batchBase}/cases`;
  r.get(
    caseBase,
    validate({ params: batchParamSchema, query: listCasesQuerySchema }),
    ...batchOp,
    authorizeOrg('farm.case.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.listCases),
  );
  r.get(
    `${caseBase}/summary`,
    validate({ params: batchParamSchema }),
    ...batchOp,
    authorizeOrg('farm.case.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.caseSummary),
  );
  r.post(
    caseBase,
    validate({ params: batchParamSchema, body: createCaseBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.create'),
    withSheepBatch,
    asyncHandler(opsCtrl.createCase),
  );
  r.get(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.case.read'),
    withSheepBatch,
    asyncHandler(opsCtrl.getCase),
  );
  r.patch(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema, body: updateCaseBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.update'),
    withSheepBatch,
    asyncHandler(opsCtrl.updateCase),
  );
  r.delete(
    `${caseBase}/:caseId`,
    validate({ params: caseIdParamSchema }),
    ...batchOp,
    authorizeOrg('farm.case.delete'),
    withSheepBatch,
    asyncHandler(opsCtrl.deleteCase),
  );
  r.post(
    `${caseBase}/:caseId/image/upload-url`,
    validate({ params: caseIdParamSchema, body: imageUploadUrlBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.update'),
    withSheepBatch,
    asyncHandler(opsCtrl.requestCaseImageUploadUrl),
  );
  r.post(
    `${caseBase}/:caseId/image`,
    validate({ params: caseIdParamSchema, body: registerImageBodySchema }),
    ...batchOp,
    authorizeOrg('farm.case.update'),
    withSheepBatch,
    asyncHandler(opsCtrl.registerCaseImage),
  );

  return r;
}
