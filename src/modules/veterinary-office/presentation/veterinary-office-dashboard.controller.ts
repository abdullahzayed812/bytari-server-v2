import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/http/response.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { VeterinaryOfficeDashboardService } from '../application/veterinary-office-dashboard.service.js';

export class VeterinaryOfficeDashboardController {
  constructor(private readonly dashboard: VeterinaryOfficeDashboardService) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { userId } = requireAuth(req);
    sendSuccess(res, await this.dashboard.getSummary(org.id, userId));
  };
}
