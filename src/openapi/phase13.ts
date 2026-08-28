/**
 * OpenAPI fragments for Phase 13 (Consultations & Inquiries). Merged into the
 * base document by `buildOpenApiDocument`.
 *
 * Two structurally-identical support-thread aggregates (docs 05 §5.18–5.19):
 *   Consultation  Pet Owner → general veterinary question (optional owned-animal
 *                 reference). Any authenticated user may create.
 *   Inquiry       Approved Veterinarian → general question. Non-vets / pending
 *                 vets are rejected (403).
 *
 * Access: CREATOR = `createdByUserId` (relationship-scoped). RESPONDER = the
 * ADMIN override, or an ACTIVE CONSULTATION / INQUIRY system-supervisor domain
 * assignment held by an approved veterinarian. A caller with no relationship
 * gets 404 (ids never leak). Creator / responder identity and message `source`
 * are always derived from `req.auth` — the request body cannot set them.
 *
 * Lifecycle: OPEN → CLOSED (terminal, responder/admin only, idempotent). A
 * responder may also block the sender — the creator becomes read-only while the
 * thread stays OPEN for responders (UC-023 / UC-027).
 *
 * Realtime rooms `consultation:<id>` / `inquiry:<id>` reuse the Phase-12
 * WebSocket seam (see ARCHITECTURE.md §16.4 / §20).
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. animalId is not an animal you own)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but not permitted (not an approved vet; not a responder)',
    404: 'Thread not found, or the caller has no relationship to it',
    409: 'The thread is closed / the sender is blocked (THREAD_NOT_WRITABLE)',
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
const threadIdParam = { name: 'threadId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  { name: 'status', in: 'query', schema: { type: 'string', enum: ['OPEN', 'CLOSED'] } },
];

const schemas: Obj = {
  SupportThread: {
    type: 'object',
    properties: {
      id: uuid,
      kind: { type: 'string', enum: ['CONSULTATION', 'INQUIRY'] },
      status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
      createdByUserId: uuid,
      animalId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        description: 'Consultations only; always null for inquiries.',
      },
      senderBlocked: {
        type: 'boolean',
        description: 'The creator has been muted (thread stays OPEN).',
      },
      aiResponded: { type: 'boolean' },
      lastMessageAt: { type: 'string', format: 'date-time', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  SupportThreadMessage: {
    type: 'object',
    properties: {
      id: uuid,
      consultationId: {
        type: 'string',
        format: 'uuid',
        description: 'Present on consultation messages.',
      },
      inquiryId: { type: 'string', format: 'uuid', description: 'Present on inquiry messages.' },
      senderUserId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        description: 'null for AI / SYSTEM messages.',
      },
      source: { type: 'string', enum: ['USER', 'SUPERVISOR', 'ADMIN', 'AI', 'SYSTEM'] },
      body: { type: 'string', nullable: true, description: 'null for a soft-deleted message.' },
      deletedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateConsultationRequest: {
    type: 'object',
    required: ['body'],
    description: 'The first message. `createdBy` / `senderUserId` are never accepted.',
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 4000 },
      animalId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        description: 'Optional — must be an animal the caller currently owns.',
      },
    },
    additionalProperties: false,
  },
  CreateInquiryRequest: {
    type: 'object',
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } },
    additionalProperties: false,
  },
  SendThreadMessageRequest: {
    type: 'object',
    required: ['body'],
    properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } },
    additionalProperties: false,
  },
  AiSettings: {
    type: 'object',
    properties: {
      consultationAiEnabled: { type: 'boolean' },
      inquiryAiEnabled: { type: 'boolean' },
    },
  },
  UpdateAiSettingsRequest: {
    type: 'object',
    minProperties: 1,
    properties: {
      consultationAiEnabled: { type: 'boolean' },
      inquiryAiEnabled: { type: 'boolean' },
    },
    additionalProperties: false,
  },
};

function threadPaths(base: string, tag: string, createRef: string): Obj {
  return {
    [`/${base}`]: {
      get: {
        tags: [tag],
        summary: `List the caller's ${base}`,
        description: 'Threads the caller created. Newest activity first.',
        security: bearer,
        parameters: pageParams,
        responses: {
          '200': ok('Paginated threads', listOf('#/components/schemas/SupportThread')),
          ...errs(401, 422),
        },
      },
      post: {
        tags: [tag],
        summary: `Create a ${base.slice(0, -1)}`,
        description:
          base === 'inquiries'
            ? 'Requires an APPROVED veterinarian. Creates the thread + the first USER message; ' +
              'if INQUIRY AI is enabled an AI reply is generated through the provider seam ' +
              '(no real provider in Phase 13).'
            : 'Any authenticated user. Creates the thread + the first USER message; if ' +
              'CONSULTATION AI is enabled an AI reply is generated through the provider seam ' +
              '(no real provider in Phase 13).',
        security: bearer,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: createRef } } },
        },
        responses: {
          '201': ok('Created', dataOf({ $ref: '#/components/schemas/SupportThread' })),
          ...errs(400, 401, 403, 422),
        },
      },
    },
    [`/${base}/{threadId}`]: {
      get: {
        tags: [tag],
        summary: 'Get one thread',
        description: 'Creator, or a responder (supervisor / admin). Otherwise 404.',
        security: bearer,
        parameters: [threadIdParam],
        responses: {
          '200': ok('Thread', dataOf({ $ref: '#/components/schemas/SupportThread' })),
          ...errs(401, 404),
        },
      },
    },
    [`/${base}/{threadId}/messages`]: {
      get: {
        tags: [tag],
        summary: 'List messages (oldest first)',
        security: bearer,
        parameters: [
          threadIdParam,
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: {
          '200': ok('Paginated messages', listOf('#/components/schemas/SupportThreadMessage')),
          ...errs(401, 404, 422),
        },
      },
      post: {
        tags: [tag],
        summary: 'Post a message',
        description:
          'CREATOR while OPEN and not blocked → `source: USER`. RESPONDER while OPEN → ' +
          '`source: SUPERVISOR` (or `ADMIN`). CLOSED / blocked → 409 THREAD_NOT_WRITABLE.',
        security: bearer,
        parameters: [threadIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SendThreadMessageRequest' },
            },
          },
        },
        responses: {
          '201': ok(
            'Message posted',
            dataOf({ $ref: '#/components/schemas/SupportThreadMessage' }),
          ),
          ...errs(401, 403, 404, 409, 422),
        },
      },
    },
    [`/${base}/{threadId}/close`]: {
      post: {
        tags: [tag],
        summary: 'Close the thread',
        description: 'Responder / admin only; idempotent. CLOSED is terminal for everyone.',
        security: bearer,
        parameters: [threadIdParam],
        responses: {
          '200': ok('Closed', dataOf({ $ref: '#/components/schemas/SupportThread' })),
          ...errs(401, 403, 404),
        },
      },
    },
    [`/${base}/{threadId}/block`]: {
      post: {
        tags: [tag],
        summary: 'Block the sender (mute the creator)',
        description: 'Responder / admin only; idempotent. The thread stays OPEN for responders.',
        security: bearer,
        parameters: [threadIdParam],
        responses: {
          '200': ok('Sender blocked', dataOf({ $ref: '#/components/schemas/SupportThread' })),
          ...errs(401, 403, 404),
        },
      },
    },
    [`/${base}/{threadId}/unblock`]: {
      post: {
        tags: [tag],
        summary: 'Unblock the sender',
        security: bearer,
        parameters: [threadIdParam],
        responses: {
          '200': ok('Sender unblocked', dataOf({ $ref: '#/components/schemas/SupportThread' })),
          ...errs(401, 403, 404),
        },
      },
    },
  };
}

function adminThreadPaths(base: string): Obj {
  const perm = base === 'consultations' ? 'consultation.admin.read' : 'inquiry.admin.read';
  return {
    [`/admin/${base}`]: {
      get: {
        tags: ['Consultations & Inquiries · Admin'],
        summary: `List all ${base} (system-wide)`,
        description: `Requires \`${perm}\` (ADMIN, or the matching supervisor domain).`,
        security: bearer,
        parameters: [...pageParams, { name: 'createdBy', in: 'query', schema: uuid }],
        responses: {
          '200': ok('Paginated threads', listOf('#/components/schemas/SupportThread')),
          ...errs(401, 403, 422),
        },
      },
    },
    [`/admin/${base}/{threadId}`]: {
      get: {
        tags: ['Consultations & Inquiries · Admin'],
        summary: `Get any ${base.slice(0, -1)}`,
        security: bearer,
        parameters: [threadIdParam],
        responses: {
          '200': ok('Thread', dataOf({ $ref: '#/components/schemas/SupportThread' })),
          ...errs(401, 403, 404),
        },
      },
    },
  };
}

const paths: Obj = {
  ...threadPaths(
    'consultations',
    'Consultations',
    '#/components/schemas/CreateConsultationRequest',
  ),
  ...threadPaths('inquiries', 'Inquiries', '#/components/schemas/CreateInquiryRequest'),
  ...adminThreadPaths('consultations'),
  ...adminThreadPaths('inquiries'),
  '/admin/ai-settings': {
    get: {
      tags: ['Consultations & Inquiries · Admin'],
      summary: 'Read the AI-enablement flags',
      description: 'Requires `ai.settings.manage` (ADMIN only in Phase 13).',
      security: bearer,
      responses: {
        '200': ok('AI settings', dataOf({ $ref: '#/components/schemas/AiSettings' })),
        ...errs(401, 403),
      },
    },
    patch: {
      tags: ['Consultations & Inquiries · Admin'],
      summary: 'Enable / disable AI responses',
      description:
        'Requires `ai.settings.manage`. Phase 13 stores the flag only — there is no AI ' +
        'provider yet, so enabling it produces an AI message only once a Phase 14+ provider ' +
        'is bound.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateAiSettingsRequest' } },
        },
      },
      responses: {
        '200': ok('Updated AI settings', dataOf({ $ref: '#/components/schemas/AiSettings' })),
        ...errs(401, 403, 422),
      },
    },
  },
};

const tags = [
  { name: 'Consultations', description: 'Pet Owner → general veterinary consultation threads' },
  { name: 'Inquiries', description: 'Approved Veterinarian → general inquiry threads' },
  {
    name: 'Consultations & Inquiries · Admin',
    description: 'System-wide listing + AI-enablement flags',
  },
];

export const phase13OpenApi = { tags, paths, schemas };
