import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import {
  BODY_MAX,
  DEVICE_PLATFORMS,
  NOTIFICATION_TYPES,
  PUSH_DATA_MAX_KEYS,
  TITLE_MAX,
} from '../domain/notification.constants.js';

export const notificationIdParamSchema = z.object({ notificationId: z.string().uuid() });
export const deviceIdParamSchema = z.object({ deviceId: z.string().uuid() });

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  read: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

/** `userId` is NEVER accepted — device ownership is always `req.auth`. */
export const registerDeviceBodySchema = z
  .object({
    token: z.string().trim().min(10).max(4096),
    platform: z.enum(DEVICE_PLATFORMS),
    deviceId: z.string().trim().min(1).max(200).nullable().optional(),
    appVersion: z.string().trim().min(1).max(50).nullable().optional(),
  })
  .strict();

export const updatePreferencesBodySchema = z.object({ pushEnabled: z.boolean() }).strict();

const stringData = z
  .record(z.string().max(200))
  .refine((d) => Object.keys(d).length <= PUSH_DATA_MAX_KEYS, {
    message: `data may have at most ${PUSH_DATA_MAX_KEYS} keys`,
  });

export const adminNotificationBodySchema = z
  .object({
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('USER'), userId: z.string().uuid() }).strict(),
      z
        .object({ kind: z.literal('ROLE'), roleKey: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })
        .strict(),
      z.object({ kind: z.literal('ALL') }).strict(),
    ]),
    type: z.enum(NOTIFICATION_TYPES),
    title: z.string().trim().min(1).max(TITLE_MAX),
    body: z.string().trim().min(1).max(BODY_MAX),
    data: stringData.optional(),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBodySchema>;
export type AdminNotificationBody = z.infer<typeof adminNotificationBodySchema>;
