import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { NotificationService } from '../application/notification.service.js';
import type {
  AdminNotificationBody,
  ListNotificationsQuery,
  RegisterDeviceBody,
  UpdatePreferencesBody,
} from './notification.schemas.js';

export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- notifications --------------------------------------------

  list = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const q = validatedQuery<ListNotificationsQuery>(req);
    const { items, total } = await this.service.list(userId, {
      page: q.page,
      pageSize: q.pageSize,
      read: q.read,
      type: q.type,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  unreadCount = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    sendSuccess(res, { count: await this.service.unreadCount(userId) });
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { notificationId } = validatedParams<{ notificationId: string }>(req);
    sendSuccess(res, await this.service.get(userId, notificationId));
  };

  markRead = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { notificationId } = validatedParams<{ notificationId: string }>(req);
    sendSuccess(res, await this.service.markRead(userId, notificationId));
  };

  markAllRead = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    sendSuccess(res, await this.service.markAllRead(userId));
  };

  // --- preferences --------------------------------------------

  getPreferences = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const prefs = await this.service.getPreferences(userId);
    sendSuccess(res, { pushEnabled: prefs.pushEnabled, updatedAt: prefs.updatedAt });
  };

  updatePreferences = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<UpdatePreferencesBody>(req);
    const prefs = await this.service.updatePreferences(this.actor(req), body);
    sendSuccess(res, { pushEnabled: prefs.pushEnabled, updatedAt: prefs.updatedAt });
  };

  // --- device tokens -----------------------------------------

  registerDevice = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<RegisterDeviceBody>(req);
    sendSuccess(
      res,
      await this.service.registerDevice(this.actor(req), {
        token: body.token,
        platform: body.platform,
        deviceId: body.deviceId ?? null,
        appVersion: body.appVersion ?? null,
      }),
      StatusCodes.CREATED,
    );
  };

  listDevices = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    sendSuccess(res, await this.service.listDevices(userId));
  };

  removeDevice = async (req: Request, res: Response): Promise<void> => {
    const { deviceId } = validatedParams<{ deviceId: string }>(req);
    await this.service.removeDevice(this.actor(req), deviceId);
    res.status(StatusCodes.NO_CONTENT).send();
  };

  // --- admin -------------------------------------------------

  adminSend = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<AdminNotificationBody>(req);
    sendSuccess(res, await this.service.adminBroadcast(this.actor(req), body), StatusCodes.CREATED);
  };
}
