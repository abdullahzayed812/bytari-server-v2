import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type {
  NotificationVideoLinkService,
  VideoLinkActor,
} from '../application/notification-video-link.service.js';
import type { SetVideoLinkBody, VideoLinkKeyParam } from './notification.schemas.js';

/** `/admin/notifications/video-links` — acceptance-notification video links. */
export class NotificationVideoLinkController {
  constructor(private readonly service: NotificationVideoLinkService) {}

  private actor(req: Request): VideoLinkActor {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.service.list());
  };

  set = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<VideoLinkKeyParam>(req);
    const { url } = validatedBody<SetVideoLinkBody>(req);
    sendSuccess(res, await this.service.set(key, url, this.actor(req)));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<VideoLinkKeyParam>(req);
    await this.service.remove(key, this.actor(req));
    res.status(StatusCodes.NO_CONTENT).end();
  };
}
