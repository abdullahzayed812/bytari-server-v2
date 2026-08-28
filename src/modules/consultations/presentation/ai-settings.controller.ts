import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AiSettingsService } from '../application/ai-settings.service.js';
import type { UpdateAiSettingsBody } from './thread.schemas.js';

/** Admin-only AI enablement flags. */
export class AiSettingsController {
  constructor(private readonly service: AiSettingsService) {}

  get = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.service.view());
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<UpdateAiSettingsBody>(req);
    const updated = await this.service.update(
      { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) },
      body,
    );
    sendSuccess(res, updated);
  };
}
