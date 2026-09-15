import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AdminDashboardService } from '../application/admin-dashboard.service.js';
import type { AdminDashboardCardId } from '../domain/admin-dashboard.types.js';

export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    sendSuccess(res, await this.dashboard.getSummary(userId), StatusCodes.OK);
  };

  markCardSeen = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { cardId } = validatedParams<{ cardId: AdminDashboardCardId }>(req);
    await this.dashboard.markCardSeen(userId, cardId);
    sendSuccess(res, { seen: true });
  };
}
