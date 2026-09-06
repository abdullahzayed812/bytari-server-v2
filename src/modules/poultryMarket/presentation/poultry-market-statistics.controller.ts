import type { Request, Response } from 'express';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { PoultryMarketStatisticsService } from '../application/poultry-market-statistics.service.js';

export class PoultryMarketStatisticsController {
  constructor(
    private readonly stats: PoultryMarketStatisticsService,
    private readonly authz: AuthorizationService,
  ) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    if (!this.authz.isAdmin(auth) && !this.authz.isApprovedTrader(auth)) {
      throw new ForbiddenError('Statistics are available to admins and approved traders', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
    sendSuccess(res, await this.stats.getSummary());
  };
}
