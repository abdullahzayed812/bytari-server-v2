/**
 * OpenAPI fragments for Phase 12 (Chat & Real-Time Messaging). Merged into the
 * base document by `buildOpenApiDocument`.
 *
 * Two conversation contexts only (docs 01 §9, UC-018 / UC-019):
 *   PET_OWNER_CLINIC   Pet Owner ↔ a CLINIC organization (any ACTIVE clinic
 *                      member acts on the clinic side).
 *   FARM_OWNER_MEMBER  Farm Owner ↔ one assigned FARM member.
 *
 * Access is RELATIONSHIP-scoped (conversation participant / current org
 * membership), evaluated live on every request — not a global permission and
 * not a stored flag. A caller with no relationship gets 404 (ids do not leak).
 *
 * The WebSocket protocol (`/realtime`) is documented in ARCHITECTURE.md §16.4, not
 * here — OpenAPI covers HTTP only.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. the organization is not a CLINIC/FARM, or a bad target)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but not permitted (organization not ACTIVE, or not your message)',
    404: 'Conversation / message not found, or the caller has no relationship to it',
    409: 'Conflict with current state',
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
const orgIdParam = { name: 'organizationId', in: 'path', required: true, schema: uuid };
const conversationIdParam = { name: 'conversationId', in: 'path', required: true, schema: uuid };
const messageIdParam = { name: 'messageId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const schemas: Obj = {
  Conversation: {
    type: 'object',
    properties: {
      id: uuid,
      type: { type: 'string', enum: ['PET_OWNER_CLINIC', 'FARM_OWNER_MEMBER'] },
      organizationId: uuid,
      counterpartUserId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        description: 'The individual on the personal side (pet owner / farm member).',
      },
      viewerSide: {
        type: 'string',
        enum: ['PET_OWNER', 'CLINIC', 'FARM_OWNER', 'FARM_MEMBER'],
        description: "The caller's resolved side for this conversation.",
      },
      lastMessageAt: { type: 'string', format: 'date-time', nullable: true },
      unreadCount: {
        type: 'integer',
        nullable: true,
        description: 'null when read state is not tracked for the caller (dynamic clinic side).',
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  Message: {
    type: 'object',
    properties: {
      id: uuid,
      conversationId: uuid,
      senderUserId: uuid,
      body: { type: 'string', nullable: true, description: 'null for a soft-deleted message.' },
      type: { type: 'string', enum: ['TEXT', 'SYSTEM'] },
      deletedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateConversationRequest: {
    type: 'object',
    description:
      '`organizationId` comes from the URL; the creator is `req.auth`. `targetUserId` is ' +
      'required only when the organization side opens the conversation (a clinic member ' +
      'naming the pet owner, or the farm owner naming the member); omitted when a pet owner ' +
      'or farm member opens their own conversation.',
    properties: { targetUserId: uuid },
    additionalProperties: false,
  },
  SendMessageRequest: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 4000 },
      type: { type: 'string', enum: ['TEXT'], default: 'TEXT' },
    },
    additionalProperties: false,
  },
  MarkReadRequest: {
    type: 'object',
    required: ['messageId'],
    properties: { messageId: uuid },
    additionalProperties: false,
  },
};

const TAG = 'Chat';

const paths: Obj = {
  '/organizations/{organizationId}/conversations': {
    post: {
      tags: [TAG],
      summary: 'Start (or fetch) a conversation with this organization',
      description:
        'CLINIC → Pet Owner ↔ Clinic; FARM → Farm Owner ↔ member. Idempotent: returns the ' +
        'existing conversation (200) or a new one (201). The relationship is enforced ' +
        'server-side — a clinic member must name a non-member `targetUserId`; the farm ' +
        'owner must name an ACTIVE non-owner member.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateConversationRequest' },
          },
        },
      },
      responses: {
        '200': ok('Existing conversation', dataOf({ $ref: '#/components/schemas/Conversation' })),
        '201': ok('Conversation created', dataOf({ $ref: '#/components/schemas/Conversation' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/conversations': {
    get: {
      tags: [TAG],
      summary: "List the caller's conversations",
      description:
        'Conversations where the caller is a participant, plus every Pet Owner ↔ Clinic ' +
        'conversation of a clinic they are an ACTIVE member of. Newest activity first. ' +
        'Optional `organizationId` filter.',
      security: bearer,
      parameters: [...pageParams, { name: 'organizationId', in: 'query', schema: uuid }],
      responses: {
        '200': ok('Paginated conversations', listOf('#/components/schemas/Conversation')),
        ...errs(401, 422),
      },
    },
  },
  '/conversations/{conversationId}': {
    get: {
      tags: [TAG],
      summary: 'Get one conversation',
      description: 'A conversation the caller has no current relationship to returns 404.',
      security: bearer,
      parameters: [conversationIdParam],
      responses: {
        '200': ok('Conversation', dataOf({ $ref: '#/components/schemas/Conversation' })),
        ...errs(401, 404),
      },
    },
  },
  '/conversations/{conversationId}/messages': {
    get: {
      tags: [TAG],
      summary: 'List messages in a conversation',
      description:
        'Paginated, newest first (`created_at` desc, `id` desc). Deleted messages ' +
        'appear with `body: null` and `deletedAt` set so ordering / unread state survive.',
      security: bearer,
      parameters: [conversationIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated messages', listOf('#/components/schemas/Message')),
        ...errs(401, 404, 422),
      },
    },
    post: {
      tags: [TAG],
      summary: 'Send a message',
      description:
        'The sender is `req.auth` — `senderUserId` in the body is ignored. The conversation ' +
        'must be one the caller can access and the organization must be ACTIVE. Emits ' +
        '`chat.message.created` (ids-only) after commit; the realtime layer delivers it to ' +
        'the `conversation:<id>` room.',
      security: bearer,
      parameters: [conversationIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } },
        },
      },
      responses: {
        '201': ok('Message sent', dataOf({ $ref: '#/components/schemas/Message' })),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/conversations/{conversationId}/read': {
    post: {
      tags: [TAG],
      summary: 'Mark the conversation read up to a message',
      description:
        "Advances the caller's `last_read_message_id`. No-op (returns the conversation with " +
        '`unreadCount: null`) for the dynamic clinic side, which has no per-member read state ' +
        'in this phase.',
      security: bearer,
      parameters: [conversationIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/MarkReadRequest' } },
        },
      },
      responses: {
        '200': ok('Updated conversation', dataOf({ $ref: '#/components/schemas/Conversation' })),
        ...errs(400, 401, 404, 422),
      },
    },
  },
  '/messages/{messageId}': {
    delete: {
      tags: [TAG],
      summary: 'Soft-delete your own message',
      description:
        'Only the sender may delete; idempotent. The row is kept (ordering / unread / ' +
        'history) with `deleted_at` set. Audited as `MESSAGE_DELETED`; emits ' +
        '`chat.message.deleted`.',
      security: bearer,
      parameters: [messageIdParam],
      responses: {
        '200': ok('Message deleted', dataOf({ $ref: '#/components/schemas/Message' })),
        ...errs(401, 403, 404),
      },
    },
  },
};

const tags = [
  {
    name: TAG,
    description:
      'Chat & real-time messaging — Pet Owner ↔ Clinic and Farm Owner ↔ member. ' +
      'Relationship-scoped; WebSocket delivery over /realtime (see ARCHITECTURE.md §16.4).',
  },
];

export const phase12OpenApi = { tags, paths, schemas };
