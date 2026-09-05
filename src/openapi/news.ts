/**
 * OpenAPI fragments for "News" (آخر الأخبار) — a general news type inside the
 * content module, the same shape as "Tips". Public reads need only
 * authentication (PUBLISHED news only); `/admin/news*` management reuses the
 * `content.*` permissions (ADMIN or an approved-vet CONTENT system-supervisor).
 * Bookmark toggles are auth + self only. Cover + gallery images use the shared
 * presigned-R2 flow.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (bad tag, oversized field, invalid points, gallery cap)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the required content.* permission / approved-vet',
    404: 'News not found (or not PUBLISHED for a public read)',
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
const newsIdParam = { name: 'newsId', in: 'path', required: true, schema: uuid };
const tagEnum = ['NORMAL', 'URGENT', 'IMPORTANT_ALERT'];
const statusEnum = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  { name: 'q', in: 'query', schema: { type: 'string' } },
  { name: 'categoryId', in: 'query', schema: uuid },
  { name: 'tag', in: 'query', schema: { type: 'string', enum: tagEnum } },
];

const tags = [
  { name: 'News', description: 'آخر الأخبار — public reads + bookmarks' },
  { name: 'News (Admin)', description: 'News management — Admin / Content Supervisor' },
];

const CategoryRef = {
  type: 'object',
  nullable: true,
  properties: { id: uuid, slug: { type: 'string' }, name: { type: 'string' } },
};

const schemas: Obj = {
  NewsListItem: {
    type: 'object',
    properties: {
      id: uuid,
      title: { type: 'string' },
      summary: { type: 'string', nullable: true },
      source: { type: 'string', nullable: true },
      isFeatured: { type: 'boolean' },
      tag: { type: 'string', enum: tagEnum },
      category: CategoryRef,
      coverImageUrl: { type: 'string', nullable: true },
      bookmarkCount: { type: 'integer' },
      isBookmarked: { type: 'boolean' },
      publishedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  News: {
    allOf: [
      { $ref: '#/components/schemas/NewsListItem' },
      {
        type: 'object',
        properties: {
          body: { type: 'string', nullable: true },
          reasonPoints: { type: 'array', items: { type: 'string' } },
          advicePoints: { type: 'array', items: { type: 'string' } },
          alertNote: { type: 'string', nullable: true },
          galleryUrls: { type: 'array', items: { type: 'string' } },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    ],
  },
  AdminNews: {
    allOf: [
      { $ref: '#/components/schemas/News' },
      {
        type: 'object',
        properties: {
          status: { type: 'string', enum: statusEnum },
          createdByUserId: { type: 'string', format: 'uuid', nullable: true },
          updatedByUserId: { type: 'string', format: 'uuid', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    ],
  },
  CreateNewsRequest: {
    type: 'object',
    required: ['title'],
    description: '`status` / `publishedAt` / cover / gallery are server-controlled.',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 300 },
      summary: { type: 'string', maxLength: 4000, nullable: true },
      source: { type: 'string', maxLength: 200, nullable: true },
      isFeatured: { type: 'boolean' },
      tag: { type: 'string', enum: tagEnum },
      categoryId: { ...uuid, nullable: true },
      body: { type: 'string', maxLength: 20000, nullable: true },
      reasonPoints: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
      advicePoints: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 20 },
      alertNote: { type: 'string', maxLength: 2000, nullable: true },
    },
    additionalProperties: false,
  },
};

const BOOKMARK_RESULT = dataOf({
  type: 'object',
  properties: { isBookmarked: { type: 'boolean' }, bookmarkCount: { type: 'integer' } },
});

const paths: Obj = {
  '/news': {
    get: {
      tags: ['News'],
      summary: 'List PUBLISHED news (featured first, newest first)',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'featured', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        { name: 'bookmarked', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
      ],
      responses: {
        200: ok('News list', listOf('#/components/schemas/NewsListItem')),
        ...errs(401, 422),
      },
    },
  },
  '/news/featured': {
    get: {
      tags: ['News'],
      summary: 'The most recent featured news item, or null',
      security: bearer,
      responses: {
        200: ok('Featured news or null', dataOf({ $ref: '#/components/schemas/News' })),
        ...errs(401),
      },
    },
  },
  '/news/{newsId}': {
    parameters: [newsIdParam],
    get: {
      tags: ['News'],
      summary: 'Get a PUBLISHED news item',
      security: bearer,
      responses: {
        200: ok('News detail', dataOf({ $ref: '#/components/schemas/News' })),
        ...errs(401, 404),
      },
    },
  },
  '/news/{newsId}/bookmark': {
    parameters: [newsIdParam],
    post: {
      tags: ['News'],
      summary: 'Bookmark a news item',
      security: bearer,
      responses: { 200: ok('Bookmarked', BOOKMARK_RESULT), ...errs(401, 404) },
    },
    delete: {
      tags: ['News'],
      summary: 'Remove a bookmark',
      security: bearer,
      responses: { 200: ok('Unbookmarked', BOOKMARK_RESULT), ...errs(401, 404) },
    },
  },

  '/admin/news': {
    get: {
      tags: ['News (Admin)'],
      summary: 'List news (management view) — content.read',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
        {
          name: 'includeDeleted',
          in: 'query',
          schema: { type: 'string', enum: ['true', 'false'] },
        },
      ],
      responses: {
        200: ok('News list', listOf('#/components/schemas/AdminNews')),
        ...errs(401, 403, 422),
      },
    },
    post: {
      tags: ['News (Admin)'],
      summary: 'Create a news item (DRAFT) — content.create',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateNewsRequest' } },
        },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/admin/news/{newsId}': {
    parameters: [newsIdParam],
    get: {
      tags: ['News (Admin)'],
      summary: 'Get a news item (management view) — content.read',
      security: bearer,
      responses: {
        200: ok('News', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['News (Admin)'],
      summary: 'Update news fields — content.update',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['News (Admin)'],
      summary: 'Soft-delete a news item — content.delete (ADMIN-only)',
      security: bearer,
      responses: {
        200: ok('Deleted', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/news/{newsId}/publish': {
    parameters: [newsIdParam],
    post: {
      tags: ['News (Admin)'],
      summary: 'Publish — content.publish',
      security: bearer,
      responses: {
        200: ok('Published', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/news/{newsId}/archive': {
    parameters: [newsIdParam],
    post: {
      tags: ['News (Admin)'],
      summary: 'Archive — content.archive',
      security: bearer,
      responses: {
        200: ok('Archived', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/news/{newsId}/restore': {
    parameters: [newsIdParam],
    post: {
      tags: ['News (Admin)'],
      summary: 'Restore a soft-deleted item — content.delete (ADMIN-only)',
      security: bearer,
      responses: {
        200: ok('Restored', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/news/{newsId}/featured': {
    parameters: [newsIdParam],
    post: {
      tags: ['News (Admin)'],
      summary: 'Toggle the "خبر مميز" flag — content.publish',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['isFeatured'],
              properties: { isFeatured: { type: 'boolean' } },
            },
          },
        },
      },
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/news/{newsId}/cover': {
    parameters: [newsIdParam],
    post: {
      tags: ['News (Admin)'],
      summary: 'Register an uploaded cover image — content.upload',
      security: bearer,
      responses: {
        201: ok('Registered', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/news/{newsId}/gallery': {
    parameters: [newsIdParam],
    post: {
      tags: ['News (Admin)'],
      summary: 'Add an uploaded attached photo — content.upload',
      security: bearer,
      responses: {
        201: ok('Added', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['News (Admin)'],
      summary: 'Remove an attached photo by storage key — content.upload',
      security: bearer,
      parameters: [{ name: 'storageKey', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        200: ok('Removed', dataOf({ $ref: '#/components/schemas/AdminNews' })),
        ...errs(401, 403, 404),
      },
    },
  },
};

export const newsOpenApi = { tags, paths, schemas };
