import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { NOTIFICATION_ADMIN_SEND } from '../domain/notification.constants.js';
import { NotificationController } from './notification.controller.js';
import {
  adminNotificationBodySchema,
  deviceIdParamSchema,
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  registerDeviceBodySchema,
  updatePreferencesBodySchema,
} from './notification.schemas.js';

/**
 * `/notifications*` — every route is authentication + ownership only. A user
 * reads / marks-read only THEIR OWN notifications (repository queries are
 * `recipient_user_id`-scoped → an unknown id is a 404, never another user's
 * row) and manages only their own device tokens.
 */
export function createNotificationRouter(c: Container): Router {
  const ctrl = new NotificationController(c.notificationService);
  const r = Router();
  r.use(c.authenticate);

  // devices (before `/:notificationId` so `/devices` is not swallowed)
  r.post(
    '/devices',
    validate({ body: registerDeviceBodySchema }),
    asyncHandler(ctrl.registerDevice),
  );
  r.get('/devices', asyncHandler(ctrl.listDevices));
  r.delete(
    '/devices/:deviceId',
    validate({ params: deviceIdParamSchema }),
    asyncHandler(ctrl.removeDevice),
  );

  // preferences
  r.get('/preferences', asyncHandler(ctrl.getPreferences));
  r.patch(
    '/preferences',
    validate({ body: updatePreferencesBodySchema }),
    asyncHandler(ctrl.updatePreferences),
  );

  // notifications
  r.get('/', validate({ query: listNotificationsQuerySchema }), asyncHandler(ctrl.list));
  r.get('/unread-count', asyncHandler(ctrl.unreadCount));
  r.post('/read-all', asyncHandler(ctrl.markAllRead));
  r.get(
    '/:notificationId',
    validate({ params: notificationIdParamSchema }),
    asyncHandler(ctrl.get),
  );
  r.post(
    '/:notificationId/read',
    validate({ params: notificationIdParamSchema }),
    asyncHandler(ctrl.markRead),
  );

  return r;
}

/** `POST /admin/notifications` — administrative broadcast (explicit permission). */
export function createAdminNotificationRouter(c: Container): Router {
  const ctrl = new NotificationController(c.notificationService);
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);
  r.post(
    '/',
    authorize(NOTIFICATION_ADMIN_SEND),
    validate({ body: adminNotificationBodySchema }),
    asyncHandler(ctrl.adminSend),
  );
  return r;
}
