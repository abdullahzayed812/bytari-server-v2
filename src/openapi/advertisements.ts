/**
 * OpenAPI fragments for the Advertisement system. Merged by
 * `buildOpenApiDocument`.
 *
 * One reusable system: a campaign (`placement` + `type` BANNER|CAROUSEL,
 * active/window/priority) owns ordered slides (image + title/subtitle/CTA).
 * `GET /ads?placement=…` is the authenticated public feed; `/admin/ads*`
 * management needs `advertisement.manage` (ADMIN override or an ADVERTISEMENT
 * system-supervisor) and governs every placement. Slide images use the shared
 * presigned-R2 flow — storage keys/credentials are never exposed.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (bad placement/type, BANNER slide-count rule, bad CTA URL)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks `advertisement.manage`',
    404: 'Campaign / slide not found',
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
const campaignIdParam = { name: 'campaignId', in: 'path', required: true, schema: uuid };
const slideIdParam = { name: 'slideId', in: 'path', required: true, schema: uuid };

const PLACEMENTS = [
  'HOME',
  'PETS',
  'POULTRY_FARMS',
  'CLINICS',
  'VETERINARY_OFFICES',
  'VETERINARY_STORES',
  'CONSULTATIONS',
  'COURSES',
  'SEMINARS',
];

const schemas: Obj = {
  AdSlide: {
    type: 'object',
    properties: {
      id: uuid,
      title: { type: 'string', nullable: true },
      subtitle: { type: 'string', nullable: true },
      ctaLabel: { type: 'string', nullable: true },
      ctaUrl: { type: 'string', nullable: true },
      imageUrl: { type: 'string', nullable: true, description: 'Server-resolved R2 URL' },
      sortOrder: { type: 'integer' },
    },
  },
  AdCampaign: {
    type: 'object',
    properties: {
      id: uuid,
      placement: { type: 'string', enum: PLACEMENTS },
      type: { type: 'string', enum: ['BANNER', 'CAROUSEL'] },
      title: { type: 'string' },
      isActive: { type: 'boolean' },
      sortOrder: { type: 'integer' },
      startsAt: { type: 'string', format: 'date-time', nullable: true },
      endsAt: { type: 'string', format: 'date-time', nullable: true },
      slides: { type: 'array', items: { $ref: '#/components/schemas/AdSlide' } },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicAdCampaign: {
    type: 'object',
    properties: {
      id: uuid,
      placement: { type: 'string', enum: PLACEMENTS },
      type: { type: 'string', enum: ['BANNER', 'CAROUSEL'] },
      title: { type: 'string' },
      slides: { type: 'array', items: { $ref: '#/components/schemas/AdSlide' } },
    },
  },
};

const tags = [
  { name: 'Advertisements', description: 'In-app advertisement feed (authenticated read).' },
  {
    name: 'Advertisements (Admin)',
    description: 'Campaign + slide management — advertisement.manage.',
  },
];

const paths: Obj = {
  '/ads': {
    get: {
      tags: ['Advertisements'],
      summary: 'Eligible advertisement campaigns for a placement',
      description:
        'Active, in-window campaigns for `placement` (default `HOME`), each with its ordered imaged slides. BANNER campaigns return at most one slide.',
      security: bearer,
      parameters: [
        {
          name: 'placement',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: PLACEMENTS, default: 'HOME' },
        },
      ],
      responses: {
        200: ok('Campaigns for the placement', listOf('#/components/schemas/PublicAdCampaign')),
        ...errs(401, 422),
      },
    },
  },
  '/admin/ads': {
    get: {
      tags: ['Advertisements (Admin)'],
      summary: 'List campaigns (filter by placement / type / includeDeleted)',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'placement', in: 'query', schema: { type: 'string', enum: PLACEMENTS } },
        { name: 'type', in: 'query', schema: { type: 'string', enum: ['BANNER', 'CAROUSEL'] } },
        {
          name: 'includeDeleted',
          in: 'query',
          schema: { type: 'string', enum: ['true', 'false'] },
        },
      ],
      responses: {
        200: ok('Campaign page', listOf('#/components/schemas/AdCampaign')),
        ...errs(401, 403, 422),
      },
    },
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Create a campaign',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['placement', 'type', 'title'],
              properties: {
                placement: { type: 'string', enum: PLACEMENTS },
                type: { type: 'string', enum: ['BANNER', 'CAROUSEL'] },
                title: { type: 'string', minLength: 1, maxLength: 200 },
                sortOrder: { type: 'integer' },
                startsAt: { type: 'string', format: 'date-time', nullable: true },
                endsAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/admin/ads/{campaignId}': {
    parameters: [campaignIdParam],
    get: {
      tags: ['Advertisements (Admin)'],
      summary: 'Get one campaign with its slides',
      security: bearer,
      responses: {
        200: ok('Campaign', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Advertisements (Admin)'],
      summary: 'Update campaign fields (title / order / window)',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Advertisements (Admin)'],
      summary: 'Soft-delete a campaign',
      security: bearer,
      responses: {
        200: ok('Deleted', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/ads/{campaignId}/activate': {
    parameters: [campaignIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Activate a campaign (requires an imaged slide)',
      security: bearer,
      responses: {
        200: ok('Activated', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/admin/ads/{campaignId}/deactivate': {
    parameters: [campaignIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Deactivate a campaign',
      security: bearer,
      responses: {
        200: ok('Deactivated', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/ads/{campaignId}/restore': {
    parameters: [campaignIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Restore a soft-deleted campaign',
      security: bearer,
      responses: {
        200: ok('Restored', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/ads/{campaignId}/slides': {
    parameters: [campaignIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Add a slide (BANNER caps at 1, CAROUSEL at 10)',
      security: bearer,
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', nullable: true },
                subtitle: { type: 'string', nullable: true },
                ctaLabel: { type: 'string', nullable: true },
                ctaUrl: { type: 'string', nullable: true },
                sortOrder: { type: 'integer' },
              },
            },
          },
        },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/AdSlide' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/ads/{campaignId}/slides/reorder': {
    parameters: [campaignIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Reorder slides — body `{ slideIds: [...] }` (a permutation)',
      security: bearer,
      responses: {
        200: ok('Reordered', dataOf({ $ref: '#/components/schemas/AdCampaign' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/ads/{campaignId}/slides/{slideId}': {
    parameters: [campaignIdParam, slideIdParam],
    patch: {
      tags: ['Advertisements (Admin)'],
      summary: 'Edit slide content (title / subtitle / CTA / order)',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/AdSlide' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Advertisements (Admin)'],
      summary: 'Remove a slide (its image is swept from R2)',
      security: bearer,
      responses: { 204: ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/admin/ads/{campaignId}/slides/{slideId}/image/upload-url': {
    parameters: [campaignIdParam, slideIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Request a presigned R2 PUT URL for a slide image',
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
  '/admin/ads/{campaignId}/slides/{slideId}/image': {
    parameters: [campaignIdParam, slideIdParam],
    post: {
      tags: ['Advertisements (Admin)'],
      summary: 'Register an uploaded slide image (validates the R2 object)',
      security: bearer,
      responses: {
        201: ok('Registered', dataOf({ $ref: '#/components/schemas/AdSlide' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
};

export const advertisementsOpenApi = { tags, paths, schemas };
