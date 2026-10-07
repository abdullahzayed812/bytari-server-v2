import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/http/response.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { ClinicDashboardService } from '../application/clinic-dashboard.service.js';
import { requireVeterinaryAnimal } from './veterinary-care.middleware.js';

/** Clinic Dashboard HTTP adapter. No business logic. */
export class ClinicDashboardController {
  constructor(private readonly dashboard: ClinicDashboardService) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    sendSuccess(res, await this.dashboard.getSummary(org.id, requireAuth(req)));
  };

  getAnimal = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const animal = requireVeterinaryAnimal(req);
    sendSuccess(res, await this.dashboard.getAnimal(org.id, animal.id));
  };
}
