import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { sendSuccess } from '../../../shared/http/response.js';
import type { Container } from '../../../container.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';

/**
 * `GET /poultry-market/access` — the caller's Markets & Exchanges state: each
 * account (merchant, owned poultry farms) evaluated independently, plus the
 * sections they unlock. The app renders its access / registration / renewal
 * screens from this; the same service guards every market route.
 */
export function createMarketAccessRouter(c: Container): Router {
  const r = Router();
  r.use(c.authenticate);
  r.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      sendSuccess(res, await c.marketAccessService.resolve(requireAuth(req)));
    }),
  );
  return r;
}
