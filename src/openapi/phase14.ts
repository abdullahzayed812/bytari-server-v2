/**
 * OpenAPI fragments for Phase 14 (Content Management). Merged by
 * `buildOpenApiDocument`.
 *
 * One `contents` aggregate — ARTICLE / BOOK / MAGAZINE — with a
 * DRAFT → PUBLISHED → ARCHIVED lifecycle and project-standard soft-delete.
 * Public endpoints show only PUBLISHED, non-deleted items; `/admin/content*`
 * shows every state and requires `content.*` (ADMIN override or the CONTENT
 * system-supervisor domain — an approved veterinarian). `content.delete` is
 * ADMIN-only. Files are stored in Object Storage; PostgreSQL keeps metadata
 * only. Upload is presigned: request a URL, PUT to storage, then register.
 * `content:feed` realtime is documented in ARCHITECTURE.md §18.7.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (bad category id, MIME / size not allowed, key mismatch, object missing)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the content permission (or is not an approved veterinarian)',
    404: 'Content / file / category not found, or not visible in its current state',
    409: 'Conflict (duplicate category slug, storage key does not belong to this content)',
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
const contentIdParam = { name: 'contentId', in: 'path', required: true, schema: uuid };
const fileIdParam = { name: 'fileId', in: 'path', required: true, schema: uuid };
const categoryIdParam = { name: 'categoryId', in: 'path', required: true, schema: uuid };
const typeEnum = ['ARTICLE', 'BOOK', 'MAGAZINE'];
const statusEnum = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];
const kindEnum = ['MAIN', 'COVER', 'ATTACHMENT'];
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  { name: 'type', in: 'query', schema: { type: 'string', enum: typeEnum } },
  { name: 'categoryId', in: 'query', schema: uuid },
  {
    name: 'q',
    in: 'query',
    schema: { type: 'string' },
    description: 'Full-text search over title + description',
  },
];

const schemas: Obj = {
  Category: {
    type: 'object',
    properties: {
      id: uuid,
      slug: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ContentFile: {
    type: 'object',
    description:
      'Admin view includes `storageKey` / `storageProvider`; the public view omits them ' +
      '(download via the `/download` route).',
    properties: {
      id: uuid,
      kind: { type: 'string', enum: kindEnum },
      originalFilename: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer' },
      storageKey: { type: 'string', description: 'Admin view only' },
      storageProvider: { type: 'string', description: 'Admin view only' },
      checksum: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  Content: {
    type: 'object',
    properties: {
      id: uuid,
      type: { type: 'string', enum: typeEnum },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      body: {
        type: 'string',
        nullable: true,
        description:
          'Article text, stored verbatim as untrusted text and never rendered by the API — ' +
          'clients MUST escape / sanitise on display.',
      },
      authorName: { type: 'string', nullable: true },
      status: { type: 'string', enum: statusEnum },
      publishedAt: { type: 'string', format: 'date-time', nullable: true },
      coverImageUrl: {
        type: 'string',
        nullable: true,
        description:
          'Resolved URL of the COVER file (public or signed), or null when there is none',
      },
      categories: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
      files: { type: 'array', items: { $ref: '#/components/schemas/ContentFile' } },
      createdByUserId: { type: 'string', format: 'uuid', nullable: true },
      updatedByUserId: { type: 'string', format: 'uuid', nullable: true },
      deletedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateContentRequest: {
    type: 'object',
    required: ['type', 'title'],
    description: '`createdBy` / `status` / `publishedAt` are server-controlled.',
    properties: {
      type: { type: 'string', enum: typeEnum },
      title: { type: 'string', minLength: 1, maxLength: 300 },
      description: { type: 'string', maxLength: 4000, nullable: true },
      body: { type: 'string', maxLength: 100000, nullable: true },
      authorName: { type: 'string', maxLength: 200, nullable: true },
      categoryIds: { type: 'array', items: uuid, maxItems: 20 },
    },
    additionalProperties: false,
  },
  UpdateContentRequest: {
    type: 'object',
    minProperties: 1,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 300 },
      description: { type: 'string', maxLength: 4000, nullable: true },
      body: { type: 'string', maxLength: 100000, nullable: true },
      authorName: { type: 'string', maxLength: 200, nullable: true },
      categoryIds: { type: 'array', items: uuid, maxItems: 20 },
    },
    additionalProperties: false,
  },
  UploadUrlRequest: {
    type: 'object',
    required: ['kind', 'filename', 'mimeType', 'size'],
    properties: {
      kind: { type: 'string', enum: kindEnum },
      filename: { type: 'string', maxLength: 255 },
      mimeType: { type: 'string' },
      size: { type: 'integer', minimum: 1, maximum: 104857600 },
    },
    additionalProperties: false,
  },
  UploadUrlResponse: {
    type: 'object',
    properties: {
      storageKey: {
        type: 'string',
        description: 'Server-generated — the client cannot choose it.',
      },
      uploadUrl: { type: 'string' },
      method: { type: 'string', enum: ['PUT'] },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      expiresInSeconds: { type: 'integer' },
    },
  },
  RegisterFileRequest: {
    type: 'object',
    required: ['storageKey', 'kind', 'filename', 'mimeType'],
    description:
      'Called AFTER the client has PUT the object. The server verifies the key belongs to ' +
      "this content, HEADs the object, and re-validates the object's REAL size / type.",
    properties: {
      storageKey: { type: 'string' },
      kind: { type: 'string', enum: kindEnum },
      filename: { type: 'string', maxLength: 255 },
      mimeType: { type: 'string' },
      checksum: { type: 'string', nullable: true },
    },
    additionalProperties: false,
  },
  FileDownloadUrl: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'A public CDN URL or a time-limited signed URL.' },
      expiresInSeconds: {
        type: 'integer',
        nullable: true,
        description: 'null when the URL is a stable public URL.',
      },
    },
  },
  CreateCategoryRequest: {
    type: 'object',
    required: ['slug', 'name'],
    properties: {
      slug: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 1000, nullable: true },
    },
    additionalProperties: false,
  },
  UpdateCategoryRequest: {
    type: 'object',
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 1000, nullable: true },
    },
    additionalProperties: false,
  },
};

const PUB = 'Content';
const ADM = 'Content · Admin';

const paths: Obj = {
  '/content': {
    get: {
      tags: [PUB],
      summary: 'Browse published content',
      description: 'Authenticated users. PUBLISHED, non-deleted items only.',
      security: bearer,
      parameters: pageParams,
      responses: {
        '200': ok('Paginated content', listOf('#/components/schemas/Content')),
        ...errs(401, 422),
      },
    },
  },
  '/content/{contentId}': {
    get: {
      tags: [PUB],
      summary: 'Get one published content item',
      description: 'A DRAFT / ARCHIVED / deleted id returns 404 here.',
      security: bearer,
      parameters: [contentIdParam],
      responses: {
        '200': ok('Content', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 404),
      },
    },
  },
  '/content/{contentId}/files/{fileId}/download': {
    get: {
      tags: [PUB],
      summary: 'Get a download URL for a published content file',
      security: bearer,
      parameters: [contentIdParam, fileIdParam],
      responses: {
        '200': ok('Download URL', dataOf({ $ref: '#/components/schemas/FileDownloadUrl' })),
        ...errs(401, 404),
      },
    },
  },
  '/content-categories': {
    get: {
      tags: [PUB],
      summary: 'List content categories',
      security: bearer,
      responses: {
        '200': ok(
          'Categories',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/Category' } }),
        ),
        ...errs(401),
      },
    },
  },

  '/admin/content': {
    get: {
      tags: [ADM],
      summary: 'List content in any state',
      description: 'Requires `content.read`. Extra filters: `status`, `includeDeleted`.',
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
        '200': ok('Paginated content', listOf('#/components/schemas/Content')),
        ...errs(401, 403, 422),
      },
    },
    post: {
      tags: [ADM],
      summary: 'Create content (starts as DRAFT)',
      description: 'Requires `content.create`.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateContentRequest' } },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/admin/content/{contentId}': {
    get: {
      tags: [ADM],
      summary: 'Get any content item (admin view, with file storage keys)',
      description: 'Requires `content.read`.',
      security: bearer,
      parameters: [contentIdParam],
      responses: {
        '200': ok('Content', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: [ADM],
      summary: 'Update content fields / categories',
      description: 'Requires `content.update`. Cannot change status or `createdBy`.',
      security: bearer,
      parameters: [contentIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateContentRequest' } },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: [ADM],
      summary: 'Soft-delete content',
      description:
        'Requires `content.delete` (ADMIN-only — not in the CONTENT supervisor domain). Idempotent.',
      security: bearer,
      parameters: [contentIdParam],
      responses: {
        '200': ok('Soft-deleted', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/content/{contentId}/restore': {
    post: {
      tags: [ADM],
      summary: 'Restore a soft-deleted content item',
      description: 'Requires `content.delete`. Idempotent.',
      security: bearer,
      parameters: [contentIdParam],
      responses: {
        '200': ok('Restored', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/content/{contentId}/publish': {
    post: {
      tags: [ADM],
      summary: 'Publish content',
      description:
        'Requires `content.publish`. DRAFT / ARCHIVED → PUBLISHED. Idempotent if already PUBLISHED.',
      security: bearer,
      parameters: [contentIdParam],
      responses: {
        '200': ok('Published', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/content/{contentId}/archive': {
    post: {
      tags: [ADM],
      summary: 'Archive content',
      description:
        'Requires `content.archive`. DRAFT / PUBLISHED → ARCHIVED. Idempotent if already ARCHIVED.',
      security: bearer,
      parameters: [contentIdParam],
      responses: {
        '200': ok('Archived', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/content/{contentId}/files/upload-url': {
    post: {
      tags: [ADM],
      summary: 'Request a presigned upload URL',
      description:
        'Requires `content.upload`. Validates MIME / size against the allow-list for `kind` ' +
        'and returns a **server-generated** storage key + a time-limited PUT URL. No DB write.',
      security: bearer,
      parameters: [contentIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UploadUrlRequest' } },
        },
      },
      responses: {
        '201': ok('Upload target', dataOf({ $ref: '#/components/schemas/UploadUrlResponse' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/content/{contentId}/files': {
    post: {
      tags: [ADM],
      summary: 'Register (or replace) an uploaded file',
      description:
        'Requires `content.upload`. Verifies the key belongs to this content, HEADs the ' +
        'object, re-validates its real size / type. A MAIN / COVER upload replaces the prior ' +
        'one (old object deleted best-effort after commit). Audited `CONTENT_FILE_UPLOADED` / `_REPLACED`.',
      security: bearer,
      parameters: [contentIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RegisterFileRequest' } },
        },
      },
      responses: {
        '201': ok('Content with the new file', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/admin/content/{contentId}/files/{fileId}': {
    delete: {
      tags: [ADM],
      summary: 'Delete a content file',
      description:
        'Requires `content.upload`. Soft-deletes the row; the object is removed best-effort after commit. Idempotent.',
      security: bearer,
      parameters: [contentIdParam, fileIdParam],
      responses: {
        '200': ok('Content without the file', dataOf({ $ref: '#/components/schemas/Content' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/content/{contentId}/files/{fileId}/download': {
    get: {
      tags: [ADM],
      summary: 'Get a download URL for any content file (any state)',
      description: 'Requires `content.read`.',
      security: bearer,
      parameters: [contentIdParam, fileIdParam],
      responses: {
        '200': ok('Download URL', dataOf({ $ref: '#/components/schemas/FileDownloadUrl' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/content-categories': {
    get: {
      tags: [ADM],
      summary: 'List categories (management view)',
      description: 'Requires `content.category.manage`.',
      security: bearer,
      responses: {
        '200': ok(
          'Categories',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/Category' } }),
        ),
        ...errs(401, 403),
      },
    },
    post: {
      tags: [ADM],
      summary: 'Create a category',
      description: 'Requires `content.category.manage`. `slug` is immutable once set.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateCategoryRequest' } },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Category' })),
        ...errs(401, 403, 409, 422),
      },
    },
  },
  '/admin/content-categories/{categoryId}': {
    patch: {
      tags: [ADM],
      summary: 'Update a category (name / description)',
      description: 'Requires `content.category.manage`.',
      security: bearer,
      parameters: [categoryIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateCategoryRequest' } },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Category' })),
        ...errs(401, 403, 404, 422),
      },
    },
    delete: {
      tags: [ADM],
      summary: 'Soft-delete a category',
      description: 'Requires `content.category.manage`. Associations are dropped.',
      security: bearer,
      parameters: [categoryIdParam],
      responses: { '204': ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
};

const tags = [
  {
    name: PUB,
    description: 'Published educational / informational content (articles, books, magazines)',
  },
  {
    name: ADM,
    description: 'Content lifecycle, files and categories — Admin / Content Supervisor',
  },
];

export const phase14OpenApi = { tags, paths, schemas };
