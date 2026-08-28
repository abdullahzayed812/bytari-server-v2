import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import { toClinicAnimalAccessDTO } from '../domain/veterinary-care.types.js';
import type { MedicalHistoryService } from '../application/medical-history.service.js';
import type { MedicalRecordService } from '../application/medical-record.service.js';
import type { VaccinationService } from '../application/vaccination.service.js';
import type { VeterinaryAccessService } from '../application/veterinary-access.service.js';
import { requireVeterinaryAnimal } from './veterinary-care.middleware.js';
import type {
  CreateMedicalRecordBody,
  CreateVaccinationBody,
  GrantAnimalAccessBody,
  ListMedicalHistoryQuery,
  ListVaccinationsQuery,
  UpdateMedicalRecordBody,
  UpdateVaccinationBody,
} from './veterinary-care.schemas.js';

interface PageQuery {
  page: number;
  pageSize: number;
}

/** Clinic-facing veterinary-care HTTP adapter. No business logic. */
export class ClinicalController {
  constructor(
    private readonly access: VeterinaryAccessService,
    private readonly records: MedicalRecordService,
    private readonly vaccinations: VaccinationService,
    private readonly history: MedicalHistoryService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- clinic ↔ animal access -------------------------------------

  grantAccess = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<GrantAnimalAccessBody>(req);
    const dto = await this.access.grant(
      { id: org.id, type: org.type },
      body.animalId,
      this.actor(req),
    );
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  revokeAccess = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { animalId } = validatedParams<{ animalId: string }>(req);
    await this.access.revoke(org.id, animalId, this.actor(req));
    sendSuccess(res, { revoked: true });
  };

  listAccess = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<PageQuery>(req);
    const { items, total } = await this.access.list(org.id, {
      page: q.page,
      pageSize: q.pageSize,
    });
    const data = items.map((it) => ({
      ...toClinicAnimalAccessDTO(it.access),
      animal: { name: it.animalName, species: it.animalSpecies, status: it.animalStatus },
    }));
    sendSuccess(res, data, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  // --- medical records -------------------------------------------

  createRecord = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const body = validatedBody<CreateMedicalRecordBody>(req);
    const dto = await this.records.createForClinic(org.id, animal, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listRecords = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const q = validatedQuery<PageQuery>(req);
    const { items, total } = await this.records.listForClinic(animal.id, {
      page: q.page,
      pageSize: q.pageSize,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getRecord = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const { recordId } = validatedParams<{ recordId: string }>(req);
    sendSuccess(res, await this.records.getForClinic(animal.id, recordId));
  };

  updateRecord = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { recordId } = validatedParams<{ recordId: string }>(req);
    const body = validatedBody<UpdateMedicalRecordBody>(req);
    sendSuccess(
      res,
      await this.records.updateForClinic(org.id, animal.id, recordId, body, this.actor(req)),
    );
  };

  deleteRecord = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { recordId } = validatedParams<{ recordId: string }>(req);
    await this.records.deleteForClinic(org.id, animal.id, recordId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- vaccinations ---------------------------------------------

  createVaccination = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const body = validatedBody<CreateVaccinationBody>(req);
    const dto = await this.vaccinations.createForClinic(org.id, animal, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listVaccinations = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const q = validatedQuery<ListVaccinationsQuery>(req);
    const { items, total } = await this.vaccinations.listForClinic(animal.id, {
      page: q.page,
      pageSize: q.pageSize,
      dueFrom: q.dueFrom,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getVaccination = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const { vaccinationId } = validatedParams<{ vaccinationId: string }>(req);
    sendSuccess(res, await this.vaccinations.getForClinic(animal.id, vaccinationId));
  };

  updateVaccination = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { vaccinationId } = validatedParams<{ vaccinationId: string }>(req);
    const body = validatedBody<UpdateVaccinationBody>(req);
    sendSuccess(
      res,
      await this.vaccinations.updateForClinic(
        org.id,
        animal.id,
        vaccinationId,
        body,
        this.actor(req),
      ),
    );
  };

  deleteVaccination = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    const { vaccinationId } = validatedParams<{ vaccinationId: string }>(req);
    await this.vaccinations.deleteForClinic(org.id, animal.id, vaccinationId, this.actor(req));
    sendSuccess(res, { deleted: true });
  };

  // --- medical history (composed timeline) -----------------------

  timeline = async (req: Request, res: Response): Promise<void> => {
    const animal = requireVeterinaryAnimal(req);
    const q = validatedQuery<ListMedicalHistoryQuery>(req);
    const { items, total } = await this.history.timelineForClinic(animal.id, {
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
