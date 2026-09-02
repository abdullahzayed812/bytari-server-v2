/**
 * OpenAPI fragments for the Clinic Details screen additions: the directory
 * photo gallery (extends the Phase 3 logo upload flow) and Pet Owner
 * engagement — follow and ratings/reviews on an organization's public
 * profile. Merged into the base document by `buildOpenApiDocument`.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request',
    401: 'Missing or invalid access token',
    403: 'Not permitted (org membership / permission / lifecycle)',
    404: 'Resource not found (or not visible to the caller)',
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

const orgIdParam = {
  name: 'organizationId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const schemas: Obj = {
  OrganizationReview: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      comment: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  OrganizationReviewWithAuthor: {
    allOf: [
      { $ref: '#/components/schemas/OrganizationReview' },
      {
        type: 'object',
        properties: {
          author: {
            type: 'object',
            properties: { firstName: { type: 'string' }, lastName: { type: 'string' } },
          },
        },
      },
    ],
  },
};

const paths: Obj = {
  '/organizations/{organizationId}/gallery/upload-url': {
    post: {
      tags: ['Organizations'],
      summary:
        'Request a presigned upload URL for a gallery photo (requires `organization.update`)',
      description:
        'CLINIC / VETERINARY_OFFICE / VETERINARY_STORE only, up to 8 photos. Same flow as the ' +
        'logo: PUT the bytes to `uploadUrl`, then POST .../gallery to register it.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['filename', 'mimeType', 'size'],
              properties: {
                filename: { type: 'string' },
                mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
                size: { type: 'integer', maximum: 5 * 1024 * 1024 },
              },
            },
          },
        },
      },
      responses: { '201': ok('Upload URL issued'), ...errs(400, 401, 403, 404, 422) },
    },
  },
  '/organizations/{organizationId}/gallery': {
    post: {
      tags: ['Organizations'],
      summary: 'Register an uploaded gallery photo (requires `organization.update`)',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['storageKey', 'mimeType'],
              properties: { storageKey: { type: 'string' }, mimeType: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': ok('Gallery updated', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Organizations'],
      summary: 'Remove one gallery photo by storage key (requires `organization.update`)',
      security: bearer,
      parameters: [
        orgIdParam,
        { name: 'storageKey', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': ok('Gallery updated', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/follow': {
    post: {
      tags: ['Organizations · Engagement'],
      summary: 'Follow an ACTIVE organization — any authenticated user, not just members',
      description: 'Idempotent — following twice is a no-op.',
      security: bearer,
      parameters: [orgIdParam],
      responses: { '200': ok('Followed'), ...errs(401, 404) },
    },
    delete: {
      tags: ['Organizations · Engagement'],
      summary: 'Unfollow an organization',
      security: bearer,
      parameters: [orgIdParam],
      responses: { '200': ok('Unfollowed'), ...errs(401, 404) },
    },
  },
  '/organizations/{organizationId}/reviews': {
    post: {
      tags: ['Organizations · Engagement'],
      summary: 'Submit (or update) your review of an ACTIVE organization',
      description: 'One review per (organization, user) — resubmitting updates rating/comment.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['rating'],
              properties: {
                rating: { type: 'integer', minimum: 1, maximum: 5 },
                comment: { type: 'string', maxLength: 1000, nullable: true },
              },
            },
          },
        },
      },
      responses: {
        '200': ok('Review saved', dataOf({ $ref: '#/components/schemas/OrganizationReview' })),
        ...errs(401, 404, 422),
      },
    },
    get: {
      tags: ['Organizations · Engagement'],
      summary: "List an organization's reviews, newest first",
      security: bearer,
      parameters: [
        orgIdParam,
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      ],
      responses: {
        '200': ok(
          'Paginated reviews',
          dataOf({
            type: 'array',
            items: { $ref: '#/components/schemas/OrganizationReviewWithAuthor' },
          }),
        ),
        ...errs(401, 404, 422),
      },
    },
  },
};

const tags = [
  {
    name: 'Organizations · Engagement',
    description:
      'Pet Owner engagement on a public organization profile — follow, ratings & reviews.',
  },
];

export const phase17OpenApi = { tags, paths, schemas };
