import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireAnimal } from '../../animals/presentation/animal.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { AnimalReminderService } from '../application/animal-reminder.service.js';
import type { ClinicDashboardService } from '../application/clinic-dashboard.service.js';
import type { MedicalRecordService } from '../application/medical-record.service.js';
import type { QuickReviewTemplateService } from '../application/quick-review-template.service.js';
import type { VaccinationService } from '../application/vaccination.service.js';
import { requireVeterinaryAnimal } from './veterinary-care.middleware.js';
import type {
  CreateQuickReviewTemplateBody,
  CreateReminderBody,
  ListClinicRemindersQuery,
  ListClinicVaccinationsQuery,
  MedicalAttachmentUploadUrlBody,
  UpdateQuickReviewTemplateBody,
  UpdateReminderBody,
} from './veterinary-care.schemas.js';

interface PageQuery {
  page: number;
  pageSize: number;
}

/** Legacy-parity clinic care (reminders, templates, clinic-wide lists, attachments). No business logic. */
export class ClinicCareController {
  constructor(
    private readonly records: MedicalRecordService,
    private readonly vaccinations: VaccinationService,
    private readonly reminders: AnimalReminderService,
    private readonly templates: QuickReviewTemplateService,
    private readonly dashboard: ClinicDashboardService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- medical attachments -----------------------------------------
  attachmentUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<MedicalAttachmentUploadUrlBody>(req);
    sendSuccess(
      res,
      await this.records.requestAttachmentUploadUrl(org.id, body),
      StatusCodes.CREATED,
    );
  };

  // --- clinic-wide vaccinations ------------------------------------
  listClinicVaccinations = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListClinicVaccinationsQuery>(req);
    const { items, total } = await this.vaccinations.listClinicWide(org.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  notifyVaccination = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { vaccinationId } = validatedParams<{ vaccinationId: string }>(req);
    sendSuccess(
      res,
      await this.vaccinations.notifyOwner(org.id, animal.id, vaccinationId, this.actor(req)),
    );
  };

  // --- reminders (clinic) ------------------------------------------
  listReminders = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const q = validatedQuery<PageQuery>(req);
    const { items, total } = await this.reminders.listForAnimal(animal.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  createReminder = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const body = validatedBody<CreateReminderBody>(req);
    sendSuccess(
      res,
      await this.reminders.createForClinic(org.id, animal, body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  getReminder = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const { reminderId } = validatedParams<{ reminderId: string }>(req);
    sendSuccess(res, await this.reminders.getForAnimal(animal.id, reminderId));
  };

  updateReminder = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { reminderId } = validatedParams<{ reminderId: string }>(req);
    const body = validatedBody<UpdateReminderBody>(req);
    sendSuccess(
      res,
      await this.reminders.updateForClinic(org.id, animal, reminderId, body, this.actor(req)),
    );
  };

  deleteReminder = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { reminderId } = validatedParams<{ reminderId: string }>(req);
    await this.reminders.deleteForClinic(org.id, animal.id, reminderId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  notifyReminder = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { reminderId } = validatedParams<{ reminderId: string }>(req);
    sendSuccess(
      res,
      await this.reminders.notifyOwner(org.id, animal.id, reminderId, this.actor(req)),
    );
  };

  listClinicReminders = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListClinicRemindersQuery>(req);
    const { items, total } = await this.reminders.listClinicWide(org.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  notifyTodayReminders = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    sendSuccess(res, await this.reminders.notifyTodayOwners(org.id, this.actor(req)));
  };

  // --- quick-review templates --------------------------------------
  listTemplates = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    sendSuccess(res, await this.templates.list(org.id));
  };

  createTemplate = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateQuickReviewTemplateBody>(req);
    sendSuccess(
      res,
      await this.templates.create(org.id, body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  updateTemplate = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { templateId } = validatedParams<{ templateId: string }>(req);
    const body = validatedBody<UpdateQuickReviewTemplateBody>(req);
    sendSuccess(res, await this.templates.update(org.id, templateId, body, this.actor(req)));
  };

  deleteTemplate = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { templateId } = validatedParams<{ templateId: string }>(req);
    await this.templates.delete(org.id, templateId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- owner-facing -------------------------------------------------
  ownerListReminders = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const q = validatedQuery<PageQuery>(req);
    const { items, total } = await this.reminders.listForAnimal(animal.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  ownerDeleteReminder = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const { reminderId } = validatedParams<{ reminderId: string }>(req);
    await this.reminders.deleteForOwner(animal.id, reminderId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  ownerListClinics = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    sendSuccess(res, await this.dashboard.clinicsForAnimal(animal.id));
  };
}
