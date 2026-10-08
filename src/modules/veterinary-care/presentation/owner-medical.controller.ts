import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { requireAnimal } from '../../animals/presentation/animal.middleware.js';
import type { MedicalHistoryService } from '../application/medical-history.service.js';
import type { VaccinationService } from '../application/vaccination.service.js';
import type { ListMedicalHistoryQuery, ListVaccinationsQuery } from './veterinary-care.schemas.js';

/**
 * Owner-facing veterinary-care reads. Mounted under `/animals/:animalId/...`
 * behind the animals module's `withAnimal` + `authorizeAnimalRead` guards, so
 * the caller is already known to be the animal's current owner (or ADMIN).
 * Read-only, and only the OWNER-VISIBLE kinds: vaccinations (+ reminders, in
 * the clinic-care router). Medical records are clinic-private — there is no
 * owner route for them.
 */
export class OwnerMedicalController {
  constructor(
    private readonly vaccinations: VaccinationService,
    private readonly history: MedicalHistoryService,
  ) {}

  listVaccinations = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const q = validatedQuery<ListVaccinationsQuery>(req);
    const { items, total } = await this.vaccinations.listForOwner(animal.id, {
      page: q.page,
      pageSize: q.pageSize,
      dueFrom: q.dueFrom,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getVaccination = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const { vaccinationId } = validatedParams<{ vaccinationId: string }>(req);
    sendSuccess(res, await this.vaccinations.getForOwner(animal.id, vaccinationId));
  };

  timeline = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const q = validatedQuery<ListMedicalHistoryQuery>(req);
    const { items, total } = await this.history.timelineForOwner(animal.id, {
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
