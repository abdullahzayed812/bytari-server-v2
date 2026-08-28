import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../shared/http/response.js';
import type { HealthService } from './health.service.js';

/**
 * Thin HTTP adapter for {@link HealthService}. No business logic here.
 */
export class HealthController {
  constructor(private readonly service: HealthService) {}

  liveness = (_req: Request, res: Response): void => {
    sendSuccess(res, this.service.liveness());
  };

  readiness = async (_req: Request, res: Response): Promise<void> => {
    const report = await this.service.readiness();
    const status = report.status === 'ready' ? StatusCodes.OK : StatusCodes.SERVICE_UNAVAILABLE;
    sendSuccess(res, report, status);
  };
}
