import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { StatusCodes } from 'http-status-codes';
import type { Container } from '../../container.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validate, validatedBody, validatedQuery } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import { SUBSCRIPTION_SUBJECTS, type SubscriptionSubject } from './subscription-info.service.js';

const infoQuerySchema = z.object({ subject: z.enum(SUBSCRIPTION_SUBJECTS) });

const infoRequestBodySchema = z
  .object({
    subject: z.enum(SUBSCRIPTION_SUBJECTS),
    organizationId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

/**
 * `/subscriptions/*` — authenticated.
 *  - `GET  /info?subject=` → the free-trial period for that subject.
 *  - `POST /info-requests` → "إرسال معلومات الاشتراك": opens a SUPPORT thread
 *    to the administration (authorization in `SubscriptionInfoService`).
 */
export function createSubscriptionRouter(c: Container): Router {
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/info',
    validate({ query: infoQuerySchema }),
    asyncHandler((req: Request, res: Response) => {
      const { subject } = validatedQuery<{ subject: SubscriptionSubject }>(req);
      sendSuccess(res, c.subscriptionInfoService.info(subject));
    }),
  );

  r.post(
    '/info-requests',
    validate({ body: infoRequestBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validatedBody<z.infer<typeof infoRequestBodySchema>>(req);
      const result = await c.subscriptionInfoService.sendInfoRequest(
        { principal: requireAuth(req), context: auditContextFromRequest(req) },
        body,
      );
      sendSuccess(res, result, StatusCodes.CREATED);
    }),
  );

  return r;
}
