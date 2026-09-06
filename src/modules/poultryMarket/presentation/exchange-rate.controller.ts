import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { ExchangeRateService } from '../application/exchange-rate.service.js';
import type {
  ExchangeRateDateQuery,
  SaveEggRatesBody,
  SavePoultryRatesBody,
} from './exchange-rate.schemas.js';

export class ExchangeRateController {
  constructor(private readonly rates: ExchangeRateService) {}

  getPoultry = async (req: Request, res: Response): Promise<void> => {
    const { date } = validatedQuery<ExchangeRateDateQuery>(req);
    sendSuccess(res, await this.rates.getPoultry(date));
  };

  savePoultry = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<SavePoultryRatesBody>(req);
    await this.rates.savePoultry(body.date, body.entries, {
      actorUserId: auth.userId,
      context: auditContextFromRequest(req),
    });
    sendSuccess(res, { success: true }, StatusCodes.OK);
  };

  getEgg = async (req: Request, res: Response): Promise<void> => {
    const { date } = validatedQuery<ExchangeRateDateQuery>(req);
    sendSuccess(res, await this.rates.getEgg(date));
  };

  saveEgg = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<SaveEggRatesBody>(req);
    await this.rates.saveEgg(body.date, body.entries, {
      actorUserId: auth.userId,
      context: auditContextFromRequest(req),
    });
    sendSuccess(res, { success: true }, StatusCodes.OK);
  };
}
