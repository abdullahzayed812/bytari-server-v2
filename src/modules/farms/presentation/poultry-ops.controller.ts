import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { FarmAppointmentService } from '../application/farm-appointment.service.js';
import type { FarmExpenseService } from '../application/farm-expense.service.js';
import type { FarmProfileService } from '../application/farm-profile.service.js';
import type { PoultryCaseService } from '../application/poultry-case.service.js';
import type { PoultryDailyRecordService } from '../application/poultry-daily-record.service.js';
import type { PoultryHealthEventService } from '../application/poultry-health-event.service.js';
import type {
  CreateAppointmentBody,
  CreateCaseBody,
  CreateDailyRecordBody,
  CreateExpenseBody,
  CreateHealthEventBody,
  ImageUploadUrlBody,
  ListAppointmentsQuery,
  ListCasesQuery,
  ListDailyRecordsQuery,
  ListExpensesQuery,
  ListHealthEventsQuery,
  RegisterImageBody,
  UpdateAppointmentBody,
  UpdateCaseBody,
  UpdateDailyRecordBody,
  UpdateExpenseBody,
  UpdateFarmProfileBody,
  UpdateHealthEventBody,
  WeeklySummaryQuery,
} from './poultry-ops.schemas.js';

/** HTTP adapter for every Poultry Farm operations entity. No business logic. */
export class PoultryOpsController {
  constructor(
    private readonly profiles: FarmProfileService,
    private readonly daily: PoultryDailyRecordService,
    private readonly expenses: FarmExpenseService,
    private readonly healthEvents: PoultryHealthEventService,
    private readonly appointments: FarmAppointmentService,
    private readonly cases: PoultryCaseService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  private orgId(req: Request): string {
    return requireOrganization(req).id;
  }

  private flockId(req: Request): string {
    return validatedParams<{ flockId: string }>(req).flockId;
  }

  // --- farm profile -------------------------------------------

  getProfile = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.profiles.getProfile(this.orgId(req)));
  };

  updateProfile = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<UpdateFarmProfileBody>(req);
    sendSuccess(res, await this.profiles.updateProfile(this.orgId(req), body, this.actor(req)));
  };

  requestProfileImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(res, await this.profiles.requestImageUploadUrl(this.orgId(req), body));
  };

  registerProfileImage = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(res, await this.profiles.registerImage(this.orgId(req), this.actor(req), body));
  };

  // --- daily records ---------------------------------------

  listDailyRecords = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListDailyRecordsQuery>(req);
    const { items, total } = await this.daily.list(this.orgId(req), this.flockId(req), {
      page: q.page,
      pageSize: q.pageSize,
      from: q.from,
      to: q.to,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = validatedParams<{ recordId: string }>(req);
    sendSuccess(res, await this.daily.get(this.orgId(req), this.flockId(req), recordId));
  };

  createDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateDailyRecordBody>(req);
    const dto = await this.daily.create(this.orgId(req), this.flockId(req), body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  updateDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = validatedParams<{ recordId: string }>(req);
    const body = validatedBody<UpdateDailyRecordBody>(req);
    sendSuccess(
      res,
      await this.daily.update(this.orgId(req), this.flockId(req), recordId, body, this.actor(req)),
    );
  };

  deleteDailyRecord = async (req: Request, res: Response): Promise<void> => {
    const { recordId } = validatedParams<{ recordId: string }>(req);
    await this.daily.delete(this.orgId(req), this.flockId(req), recordId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  batchSummary = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.daily.batchSummary(this.orgId(req), this.flockId(req)));
  };

  weeklySummary = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<WeeklySummaryQuery>(req);
    sendSuccess(res, await this.daily.weeklySummary(this.orgId(req), this.flockId(req), q.weekOf));
  };

  // --- expenses ------------------------------------------

  listExpenses = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListExpensesQuery>(req);
    const { items, total } = await this.expenses.list(this.orgId(req), {
      page: q.page,
      pageSize: q.pageSize,
      category: q.category,
      poultryFlockId: q.poultryFlockId,
      from: q.from,
      to: q.to,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  expenseSummary = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.expenses.summary(this.orgId(req)));
  };

  getExpense = async (req: Request, res: Response): Promise<void> => {
    const { expenseId } = validatedParams<{ expenseId: string }>(req);
    sendSuccess(res, await this.expenses.get(this.orgId(req), expenseId));
  };

  createExpense = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateExpenseBody>(req);
    sendSuccess(
      res,
      await this.expenses.create(this.orgId(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateExpense = async (req: Request, res: Response): Promise<void> => {
    const { expenseId } = validatedParams<{ expenseId: string }>(req);
    const body = validatedBody<UpdateExpenseBody>(req);
    sendSuccess(res, await this.expenses.update(this.orgId(req), expenseId, body, this.actor(req)));
  };

  deleteExpense = async (req: Request, res: Response): Promise<void> => {
    const { expenseId } = validatedParams<{ expenseId: string }>(req);
    await this.expenses.delete(this.orgId(req), expenseId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- health events -------------------------------------

  listHealthEvents = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListHealthEventsQuery>(req);
    const { items, total } = await this.healthEvents.list(this.orgId(req), this.flockId(req), {
      page: q.page,
      pageSize: q.pageSize,
      kind: q.kind,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const { eventId } = validatedParams<{ eventId: string }>(req);
    sendSuccess(res, await this.healthEvents.get(this.orgId(req), this.flockId(req), eventId));
  };

  createHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateHealthEventBody>(req);
    sendSuccess(
      res,
      await this.healthEvents.create(this.orgId(req), this.flockId(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const { eventId } = validatedParams<{ eventId: string }>(req);
    const body = validatedBody<UpdateHealthEventBody>(req);
    sendSuccess(
      res,
      await this.healthEvents.update(
        this.orgId(req),
        this.flockId(req),
        eventId,
        body,
        this.actor(req),
      ),
    );
  };

  deleteHealthEvent = async (req: Request, res: Response): Promise<void> => {
    const { eventId } = validatedParams<{ eventId: string }>(req);
    await this.healthEvents.delete(this.orgId(req), this.flockId(req), eventId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- appointments -------------------------------------

  listAppointments = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAppointmentsQuery>(req);
    const { items, total } = await this.appointments.list(this.orgId(req), {
      page: q.page,
      pageSize: q.pageSize,
      category: q.category,
      status: q.status,
      from: q.from,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getAppointment = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    sendSuccess(res, await this.appointments.get(this.orgId(req), appointmentId));
  };

  createAppointment = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateAppointmentBody>(req);
    sendSuccess(
      res,
      await this.appointments.create(this.orgId(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateAppointment = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    const body = validatedBody<UpdateAppointmentBody>(req);
    sendSuccess(
      res,
      await this.appointments.update(this.orgId(req), appointmentId, body, this.actor(req)),
    );
  };

  deleteAppointment = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    await this.appointments.delete(this.orgId(req), appointmentId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- individual cases --------------------------------

  listCases = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListCasesQuery>(req);
    const { items, total } = await this.cases.list(this.orgId(req), this.flockId(req), {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  caseSummary = async (req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.cases.summary(this.orgId(req), this.flockId(req)));
  };

  getCase = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    sendSuccess(res, await this.cases.get(this.orgId(req), this.flockId(req), caseId));
  };

  createCase = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCaseBody>(req);
    sendSuccess(
      res,
      await this.cases.create(this.orgId(req), this.flockId(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateCase = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    const body = validatedBody<UpdateCaseBody>(req);
    sendSuccess(
      res,
      await this.cases.update(this.orgId(req), this.flockId(req), caseId, body, this.actor(req)),
    );
  };

  deleteCase = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    await this.cases.delete(this.orgId(req), this.flockId(req), caseId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  requestCaseImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(
      res,
      await this.cases.requestImageUploadUrl(this.orgId(req), this.flockId(req), caseId, body),
    );
  };

  registerCaseImage = async (req: Request, res: Response): Promise<void> => {
    const { caseId } = validatedParams<{ caseId: string }>(req);
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(
      res,
      await this.cases.registerImage(
        this.orgId(req),
        this.flockId(req),
        caseId,
        this.actor(req),
        body,
      ),
    );
  };
}
