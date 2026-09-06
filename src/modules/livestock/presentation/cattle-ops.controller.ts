import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { CattleCaseService } from '../application/cattle-case.service.js';
import type { CattleDailyRecordService } from '../application/cattle-daily-record.service.js';
import type { CattleHealthEventService } from '../application/cattle-health-event.service.js';
import type {
  CreateCaseBody,
  CreateDailyRecordBody,
  CreateHealthEventBody,
  ImageUploadUrlBody,
  ListCasesQuery,
  ListDailyRecordsQuery,
  ListHealthEventsQuery,
  RegisterImageBody,
  UpdateCaseBody,
  UpdateDailyRecordBody,
  UpdateHealthEventBody,
  WeeklySummaryQuery,
} from './cattle-ops.schemas.js';

/** HTTP adapter for Cattle Farm daily records / health events / individual cases. No business logic. */
export class CattleOpsController {
  constructor(
    private readonly daily: CattleDailyRecordService,
    private readonly healthEvents: CattleHealthEventService,
    private readonly cases: CattleCaseService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  private orgId(req: Request): string {
    return requireOrganization(req).id;
  }

  private batchId(req: Request): string {
    return validatedParams<{ batchId: string }>(req).batchId;
  }

  // --- daily records ---------------------------------------

  listDailyRecords = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListDailyRecordsQuery>(req);
    const { items, total } = await this.daily.list(this.orgId(req), this.batchId(req), {
      page: q.page,
      pageSize: q.pageSize,
      from: q.from,
      to: q.to,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = validatedParams<{ recordId: string }>(req);
    sendSuccess(res, await this.daily.get(this.orgId(req), this.batchId(req), recordId));
  };

  createDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateDailyRecordBody>(req);
    const dto = await this.daily.create(this.orgId(req), this.batchId(req), body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  updateDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = validatedParams<{ recordId: string }>(req);
    const body = validatedBody<UpdateDailyRecordBody>(req);
    sendSuccess(
      res,
      await this.daily.update(this.orgId(req), this.batchId(req), recordId, body, this.actor(req)),
    );
  };

  deleteDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = validatedParams<{ recordId: string }>(req);
    await this.daily.delete(this.orgId(req), this.batchId(req), recordId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  batchSummary = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.daily.batchSummary(this.orgId(req), this.batchId(req)));
  };

  weeklySummary = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<WeeklySummaryQuery>(req);
    sendSuccess(res, await this.daily.weeklySummary(this.orgId(req), this.batchId(req), q.weekOf));
  };

  // --- health events -------------------------------------

  listHealthEvents = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListHealthEventsQuery>(req);
    const { items, total } = await this.healthEvents.list(this.orgId(req), this.batchId(req), {
      page: q.page,
      pageSize: q.pageSize,
      kind: q.kind,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const { eventId } = validatedParams<{ eventId: string }>(req);
    sendSuccess(res, await this.healthEvents.get(this.orgId(req), this.batchId(req), eventId));
  };

  createHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateHealthEventBody>(req);
    sendSuccess(
      res,
      await this.healthEvents.create(this.orgId(req), this.batchId(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const { eventId } = validatedParams<{ eventId: string }>(req);
    const body = validatedBody<UpdateHealthEventBody>(req);
    sendSuccess(
      res,
      await this.healthEvents.update(this.orgId(req), this.batchId(req), eventId, body, this.actor(req)),
    );
  };

  deleteHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const { eventId } = validatedParams<{ eventId: string }>(req);
    await this.healthEvents.delete(this.orgId(req), this.batchId(req), eventId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- individual cases --------------------------------

  listCases = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListCasesQuery>(req);
    const { items, total } = await this.cases.list(this.orgId(req), this.batchId(req), {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  caseSummary = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.cases.summary(this.orgId(req), this.batchId(req)));
  };

  getCase = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    sendSuccess(res, await this.cases.get(this.orgId(req), this.batchId(req), caseId));
  };

  createCase = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCaseBody>(req);
    sendSuccess(
      res,
      await this.cases.create(this.orgId(req), this.batchId(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateCase = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    const body = validatedBody<UpdateCaseBody>(req);
    sendSuccess(
      res,
      await this.cases.update(this.orgId(req), this.batchId(req), caseId, body, this.actor(req)),
    );
  };

  deleteCase = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    await this.cases.delete(this.orgId(req), this.batchId(req), caseId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  requestCaseImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(res, await this.cases.requestImageUploadUrl(this.orgId(req), this.batchId(req), caseId, body));
  };

  registerCaseImage = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(
      res,
      await this.cases.registerImage(this.orgId(req), this.batchId(req), caseId, this.actor(req), body),
    );
  };
}
