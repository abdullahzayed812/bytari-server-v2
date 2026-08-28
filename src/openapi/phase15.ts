/**
 * OpenAPI fragments for Phase 15 (Notifications & Firebase FCM). Merged by
 * `buildOpenApiDocument`.
 *
 * In-app notifications are the source of truth; FCM push and realtime
 * (`notification.created` on `user:<id>`) are extra channels. Every
 * `/notifications*` route is authentication + ownership only — a user reads /
 * marks-read only their own notifications and manages only their own device
 * tokens. `POST /admin/notifications` needs `notification.admin.send`.
 * Firebase service-account details are NEVER exposed.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (unknown target user, broadcast too large)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks `notification.admin.send`',
    404: 'Notification / device not found (or belongs to another user)',
    422: 'Request failed validation',
  };
  const out: Obj = {};
  for (const c of codes) out[String(c)] = { description: map[c] ?? 'Error', content: jsonError };
  return out;
}
function ok(description: string, schema?: Obj): Obj {
  return schema ? { description, content: { 'application/json': { schema } } } : { description };
}
function dataOf(schema: Obj): Obj {
  return { type: 'object', properties: { data: schema } };
}
function listOf(ref: string): Obj {
  return {
    type: 'object',
    properties: { data: { type: 'array', items: { $ref: ref } }, meta: { type: 'object' } },
  };
}

const uuid = { type: 'string', format: 'uuid' };
const notificationIdParam = { name: 'notificationId', in: 'path', required: true, schema: uuid };
const deviceIdParam = { name: 'deviceId', in: 'path', required: true, schema: uuid };
const typeEnum = [
  'ACCOUNT_STATUS_CHANGED',
  'ORGANIZATION_APPROVED',
  'ORGANIZATION_REJECTED',
  'ORGANIZATION_SUSPENDED',
  'ORGANIZATION_ACTIVATED',
  'ORGANIZATION_MEMBER_ADDED',
  'ORGANIZATION_MEMBER_REMOVED',
  'ORGANIZATION_SUPERVISOR_ASSIGNED',
  'SYSTEM_SUPERVISOR_ASSIGNED',
  'CHAT_MESSAGE_RECEIVED',
  'CONSULTATION_CREATED',
  'CONSULTATION_MESSAGE_RECEIVED',
  'CONSULTATION_CLOSED',
  'INQUIRY_CREATED',
  'INQUIRY_MESSAGE_RECEIVED',
  'INQUIRY_CLOSED',
  'CONTENT_PUBLISHED',
  'ADMIN_ANNOUNCEMENT',
];

const schemas: Obj = {
  Notification: {
    type: 'object',
    properties: {
      id: uuid,
      type: { type: 'string', enum: typeEnum },
      title: { type: 'string' },
      body: { type: 'string' },
      data: {
        type: 'object',
        additionalProperties: true,
        description: 'IDs + navigation metadata only.',
      },
      actorUserId: { type: 'string', format: 'uuid', nullable: true },
      entityType: { type: 'string', nullable: true },
      entityId: { type: 'string', nullable: true },
      read: { type: 'boolean' },
      readAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  DeviceToken: {
    type: 'object',
    description: 'The raw FCM token is NEVER returned — only `tokenSuffix` (last 6 chars).',
    properties: {
      id: uuid,
      platform: { type: 'string', enum: ['ios', 'android', 'web'] },
      deviceId: { type: 'string', nullable: true },
      appVersion: { type: 'string', nullable: true },
      tokenSuffix: { type: 'string' },
      lastSeenAt: { type: 'string', format: 'date-time' },
      revoked: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  RegisterDeviceRequest: {
    type: 'object',
    required: ['token', 'platform'],
    description: '`userId` is never accepted — ownership is `req.auth`.',
    properties: {
      token: { type: 'string', minLength: 10, maxLength: 4096 },
      platform: { type: 'string', enum: ['ios', 'android', 'web'] },
      deviceId: { type: 'string', maxLength: 200, nullable: true },
      appVersion: { type: 'string', maxLength: 50, nullable: true },
    },
    additionalProperties: false,
  },
  NotificationPreferences: {
    type: 'object',
    properties: {
      pushEnabled: {
        type: 'boolean',
        description: 'Gates FCM push only; in-app is always created.',
      },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  UpdateNotificationPreferencesRequest: {
    type: 'object',
    required: ['pushEnabled'],
    properties: { pushEnabled: { type: 'boolean' } },
    additionalProperties: false,
  },
  AdminNotificationRequest: {
    type: 'object',
    required: ['target', 'type', 'title', 'body'],
    properties: {
      target: {
        oneOf: [
          {
            type: 'object',
            required: ['kind', 'userId'],
            properties: { kind: { const: 'USER' }, userId: uuid },
          },
          {
            type: 'object',
            required: ['kind', 'roleKey'],
            properties: {
              kind: { const: 'ROLE' },
              roleKey: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' },
            },
          },
          { type: 'object', required: ['kind'], properties: { kind: { const: 'ALL' } } },
        ],
      },
      type: { type: 'string', enum: typeEnum },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      body: { type: 'string', minLength: 1, maxLength: 2000 },
      data: { type: 'object', additionalProperties: { type: 'string' } },
    },
    additionalProperties: false,
  },
};

const TAG = 'Notifications';

const paths: Obj = {
  '/notifications': {
    get: {
      tags: [TAG],
      summary: "List the caller's notifications (newest first)",
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'read', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'type', in: 'query', schema: { type: 'string', enum: typeEnum } },
      ],
      responses: {
        '200': ok('Paginated notifications', listOf('#/components/schemas/Notification')),
        ...errs(401, 422),
      },
    },
  },
  '/notifications/unread-count': {
    get: {
      tags: [TAG],
      summary: 'Efficient unread count',
      security: bearer,
      responses: {
        '200': ok(
          'Unread count',
          dataOf({ type: 'object', properties: { count: { type: 'integer' } } }),
        ),
        ...errs(401),
      },
    },
  },
  '/notifications/read-all': {
    post: {
      tags: [TAG],
      summary: 'Mark every notification read',
      security: bearer,
      responses: {
        '200': ok(
          'Count updated',
          dataOf({ type: 'object', properties: { updated: { type: 'integer' } } }),
        ),
        ...errs(401),
      },
    },
  },
  '/notifications/{notificationId}': {
    get: {
      tags: [TAG],
      summary: "Get one of the caller's notifications",
      description: 'A notification id belonging to another user returns 404.',
      security: bearer,
      parameters: [notificationIdParam],
      responses: {
        '200': ok('Notification', dataOf({ $ref: '#/components/schemas/Notification' })),
        ...errs(401, 404),
      },
    },
  },
  '/notifications/{notificationId}/read': {
    post: {
      tags: [TAG],
      summary: 'Mark one notification read (idempotent)',
      security: bearer,
      parameters: [notificationIdParam],
      responses: {
        '200': ok('Notification', dataOf({ $ref: '#/components/schemas/Notification' })),
        ...errs(401, 404),
      },
    },
  },
  '/notifications/preferences': {
    get: {
      tags: [TAG],
      summary: "Read the caller's notification preferences",
      security: bearer,
      responses: {
        '200': ok('Preferences', dataOf({ $ref: '#/components/schemas/NotificationPreferences' })),
        ...errs(401),
      },
    },
    patch: {
      tags: [TAG],
      summary: "Update the caller's notification preferences",
      description:
        'Only `pushEnabled` today — it gates FCM push; in-app notifications are always created.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateNotificationPreferencesRequest' },
          },
        },
      },
      responses: {
        '200': ok('Preferences', dataOf({ $ref: '#/components/schemas/NotificationPreferences' })),
        ...errs(401, 422),
      },
    },
  },
  '/notifications/devices': {
    get: {
      tags: [TAG],
      summary: "List the caller's registered devices",
      security: bearer,
      responses: {
        '200': ok(
          'Devices',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/DeviceToken' } }),
        ),
        ...errs(401),
      },
    },
    post: {
      tags: [TAG],
      summary: 'Register / refresh a device FCM token',
      description:
        'Idempotent upsert keyed by the token. Re-registering an existing token moves it to the ' +
        'current user and clears any revocation.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RegisterDeviceRequest' } },
        },
      },
      responses: {
        '201': ok('Registered device', dataOf({ $ref: '#/components/schemas/DeviceToken' })),
        ...errs(401, 422),
      },
    },
  },
  '/notifications/devices/{deviceId}': {
    delete: {
      tags: [TAG],
      summary: "Remove one of the caller's devices",
      description: 'A device id belonging to another user returns 404.',
      security: bearer,
      parameters: [deviceIdParam],
      responses: { '204': ok('Removed'), ...errs(401, 404) },
    },
  },
  '/admin/notifications': {
    post: {
      tags: [TAG],
      summary: 'Send an administrative notification',
      description:
        'Requires `notification.admin.send`. `target` is `USER` (one user), `ROLE` (all active ' +
        'users of a role) or `ALL` (all active users). In-app rows are persisted synchronously; ' +
        `FCM fan-out is detached. Refused (400 BROADCAST_TOO_LARGE) above the synchronous limit.`,
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/AdminNotificationRequest' } },
        },
      },
      responses: {
        '201': ok(
          'Broadcast accepted',
          dataOf({ type: 'object', properties: { recipientCount: { type: 'integer' } } }),
        ),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
};

const tags = [
  {
    name: TAG,
    description:
      'In-app notifications, device (FCM) tokens, preferences, and admin broadcast. ' +
      'Push via Firebase FCM (Phase-1 infra abstraction); realtime notification.created on user:<id>.',
  },
];

export const phase15OpenApi = { tags, paths, schemas };
