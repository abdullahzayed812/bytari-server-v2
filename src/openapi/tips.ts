/**
 * OpenAPI fragments for "Tips" (أفضل النصائح) — structured care advice inside
 * the content module. Public reads need only authentication (PUBLISHED tips
 * only); `/admin/tips*` management reuses the `content.*` permissions (ADMIN or
 * an approved-vet CONTENT system-supervisor). Bookmark / helpful toggles are
 * auth + self only. Cover images use the shared presigned-R2 flow.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (bad priority, oversized field, invalid points)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the required content.* permission / approved-vet',
    404: 'Tip not found (or not PUBLISHED for a public read)',
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
const tipIdParam = { name: 'tipId', in: 'path', required: true, schema: uuid };
const PRIORITIES = ['IMPORTANT', 'RECOMMENDED', 'NORMAL'];

const schemas: Obj = {
  TipCategoryRef: {
    type: 'object',
    properties: { id: uuid, slug: { type: 'string' }, name: { type: 'string' } },
  },
  TipListItem: {
    type: 'object',
    properties: {
      id: uuid,
      title: { type: 'string' },
      summary: { type: 'string', nullable: true },
      readMinutes: { type: 'integer', nullable: true },
      priority: { type: 'string', enum: PRIORITIES },
      isTipOfDay: { type: 'boolean' },
      category: { allOf: [{ $ref: '#/components/schemas/TipCategoryRef' }], nullable: true },
      coverImageUrl: { type: 'string', nullable: true },
      helpfulCount: { type: 'integer' },
      isBookmarked: { type: 'boolean' },
      isHelpful: { type: 'boolean' },
      publishedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  Tip: {
    allOf: [
      { $ref: '#/components/schemas/TipListItem' },
      {
        type: 'object',
        properties: {
          bodyIntro: { type: 'string', nullable: true },
          keyPoints: { type: 'array', items: { type: 'string' } },
          warningPoints: { type: 'array', items: { type: 'string' } },
          vetAdvice: { type: 'string', nullable: true },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    ],
  },
  AdminTip: {
    allOf: [
      { $ref: '#/components/schemas/Tip' },
      {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] },
          createdByUserId: { type: 'string', nullable: true },
          updatedByUserId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    ],
  },
};

const tags = [
  { name: 'Tips', description: 'Care-advice tips — authenticated reads + save / helpful.' },
  { name: 'Tips (Admin)', description: 'Tip management — reuses the content.* permissions.' },
];

const tipBody = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300 },
    summary: { type: 'string', nullable: true },
    readMinutes: { type: 'integer', minimum: 1, maximum: 240, nullable: true },
    priority: { type: 'string', enum: PRIORITIES },
    categoryId: { type: 'string', format: 'uuid', nullable: true },
    bodyIntro: { type: 'string', nullable: true },
    keyPoints: { type: 'array', items: { type: 'string' } },
    warningPoints: { type: 'array', items: { type: 'string' } },
    vetAdvice: { type: 'string', nullable: true },
  },
};

const paths: Obj = {
  '/tips': {
    get: {
      tags: ['Tips'],
      summary: 'List PUBLISHED tips (search / category / priority / bookmarked filters)',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'categoryId', in: 'query', schema: uuid },
        { name: 'priority', in: 'query', schema: { type: 'string', enum: PRIORITIES } },
        { name: 'bookmarked', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
      ],
      responses: {
        200: ok('Tip page', listOf('#/components/schemas/TipListItem')),
        ...errs(401, 422),
      },
    },
  },
  '/tips/tip-of-the-day': {
    get: {
      tags: ['Tips'],
      summary: 'The current featured tip (نصيحة اليوم), or null',
      security: bearer,
      responses: {
        200: ok('Featured tip or null', dataOf({ $ref: '#/components/schemas/Tip' })),
        ...errs(401),
      },
    },
  },
  '/tips/{tipId}': {
    parameters: [tipIdParam],
    get: {
      tags: ['Tips'],
      summary: 'Get one PUBLISHED tip with all sections + viewer flags',
      security: bearer,
      responses: {
        200: ok('Tip', dataOf({ $ref: '#/components/schemas/Tip' })),
        ...errs(401, 404),
      },
    },
  },
  '/tips/{tipId}/bookmark': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips'],
      summary: 'Save this tip for the caller',
      security: bearer,
      responses: {
        200: ok(
          'Bookmarked',
          dataOf({ type: 'object', properties: { isBookmarked: { type: 'boolean' } } }),
        ),
        ...errs(401, 404),
      },
    },
    delete: {
      tags: ['Tips'],
      summary: 'Remove the caller’s bookmark',
      security: bearer,
      responses: {
        200: ok(
          'Unbookmarked',
          dataOf({ type: 'object', properties: { isBookmarked: { type: 'boolean' } } }),
        ),
        ...errs(401, 404),
      },
    },
  },
  '/tips/{tipId}/helpful': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips'],
      summary: 'Mark this tip helpful (idempotent; bumps helpfulCount)',
      security: bearer,
      responses: {
        200: ok(
          'Marked helpful',
          dataOf({
            type: 'object',
            properties: { isHelpful: { type: 'boolean' }, helpfulCount: { type: 'integer' } },
          }),
        ),
        ...errs(401, 404),
      },
    },
    delete: {
      tags: ['Tips'],
      summary: 'Un-mark helpful',
      security: bearer,
      responses: {
        200: ok(
          'Un-marked',
          dataOf({
            type: 'object',
            properties: { isHelpful: { type: 'boolean' }, helpfulCount: { type: 'integer' } },
          }),
        ),
        ...errs(401, 404),
      },
    },
  },
  '/admin/tips': {
    get: {
      tags: ['Tips (Admin)'],
      summary: 'List tips in any status (content.read)',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'categoryId', in: 'query', schema: uuid },
        { name: 'priority', in: 'query', schema: { type: 'string', enum: PRIORITIES } },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] },
        },
        {
          name: 'includeDeleted',
          in: 'query',
          schema: { type: 'string', enum: ['true', 'false'] },
        },
      ],
      responses: {
        200: ok('Tip page', listOf('#/components/schemas/AdminTip')),
        ...errs(401, 403, 422),
      },
    },
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Create a tip (DRAFT) — content.create',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { ...tipBody, required: ['title'] } } },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/admin/tips/{tipId}': {
    parameters: [tipIdParam],
    get: {
      tags: ['Tips (Admin)'],
      summary: 'Get one tip (any status) — content.read',
      security: bearer,
      responses: {
        200: ok('Tip', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Tips (Admin)'],
      summary: 'Update tip fields — content.update',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: tipBody } } },
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Tips (Admin)'],
      summary: 'Soft-delete a tip — content.delete (ADMIN only)',
      security: bearer,
      responses: {
        200: ok('Deleted', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/tips/{tipId}/publish': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Publish a tip — content.publish',
      security: bearer,
      responses: {
        200: ok('Published', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/tips/{tipId}/archive': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Archive a tip — content.archive',
      security: bearer,
      responses: {
        200: ok('Archived', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/tips/{tipId}/restore': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Restore a soft-deleted tip — content.delete (ADMIN only)',
      security: bearer,
      responses: {
        200: ok('Restored', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/tips/{tipId}/tip-of-the-day': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Set / clear the featured tip — content.publish (only one at a time)',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['isTipOfDay'],
              properties: { isTipOfDay: { type: 'boolean' } },
            },
          },
        },
      },
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/tips/{tipId}/cover/upload-url': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Request a presigned R2 PUT URL for the cover — content.upload',
      security: bearer,
      responses: {
        201: ok(
          'Presigned upload',
          dataOf({
            type: 'object',
            properties: {
              storageKey: { type: 'string' },
              uploadUrl: { type: 'string' },
              method: { type: 'string', enum: ['PUT'] },
              headers: { type: 'object' },
              expiresInSeconds: { type: 'integer' },
            },
          }),
        ),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/tips/{tipId}/cover': {
    parameters: [tipIdParam],
    post: {
      tags: ['Tips (Admin)'],
      summary: 'Register an uploaded cover image — content.upload',
      security: bearer,
      responses: {
        201: ok('Registered', dataOf({ $ref: '#/components/schemas/AdminTip' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
};

export const tipsOpenApi = { tags, paths, schemas };
