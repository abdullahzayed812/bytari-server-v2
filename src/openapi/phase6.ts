/**
 * OpenAPI fragments for Phase 6 (Farms & Poultry). Merged into the base document
 * by `buildOpenApiDocument`.
 *
 * A Farm is an Organization of type `FARM` — creation / approval / profile /
 * members / supervisors are the Phase 3 organization endpoints. Phase 6 adds
 * only the Farm-ID join flow (deferred from Phase 3) and the poultry domain.
 *
 * Poultry authorization: authenticate → withOrganization → authorizeOrg(farm
 * permission) → per-flock organization scoping (a flock id that is not under the
 * URL's farm returns 404). The join flow is gated on APPROVED-vet status, not an
 * org permission (the joiner is not a member yet).
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. organization is not a FARM)',
    401: 'Missing or invalid access token',
    403: 'Not an approved veterinarian / lacks the organization permission / organization not ACTIVE',
    404: 'Not found, or not visible to the caller (unknown join code / flock not under this farm)',
    409: 'Conflict with current state (farm not active, flock closed, membership ended by the org)',
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
    properties: {
      data: { type: 'array', items: { $ref: ref } },
      meta: { type: 'object' },
    },
  };
}

const uuid = { type: 'string', format: 'uuid' };
const orgIdParam = { name: 'organizationId', in: 'path', required: true, schema: uuid };
const flockIdParam = { name: 'flockId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const birdTypeEnum = ['CHICKEN', 'DUCK', 'TURKEY', 'QUAIL', 'GOOSE', 'OTHER'];
const flockStatusEnum = ['ACTIVE', 'CLOSED'];

const poultryProductionTypeEnum = ['BROILER', 'LAYER', 'MIXED', 'BREEDER', 'HATCHERY', 'OTHER'];

const schemas: Obj = {
  CreateFarmRequest: {
    type: 'object',
    required: ['name', 'location', 'governorate', 'poultryProductionType'],
    description:
      'The "Add Poultry Farm" form. The user never picks an organization type; the backend ' +
      'creates a FARM organization + `farm_details` + the caller’s OWNER membership in one ' +
      'transaction and starts it PENDING (admin review before activation).',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 160 },
      location: { type: 'string', minLength: 1, maxLength: 200, description: 'Short display area' },
      governorate: { type: 'string', minLength: 1, maxLength: 120 },
      poultryProductionType: { type: 'string', enum: poultryProductionTypeEnum, description: 'Production type' },
      description: { type: 'string', maxLength: 2000, nullable: true },
      address: { type: 'string', maxLength: 500, nullable: true },
      capacity: { type: 'integer', minimum: 0, nullable: true },
      currentBirdCount: { type: 'integer', minimum: 0, nullable: true },
      contactName: { type: 'string', maxLength: 160, nullable: true },
      contactPhone: { type: 'string', maxLength: 40, nullable: true },
      contactEmail: { type: 'string', format: 'email', maxLength: 255, nullable: true },
    },
  },
  FarmJoinRequest: {
    type: 'object',
    required: ['joinCode'],
    properties: {
      joinCode: { type: 'string', description: 'The farm’s join code (case-insensitive)' },
    },
  },
  FarmJoinCode: {
    type: 'object',
    properties: { joinCode: { type: 'string', example: 'FARM-8F3K9Q' } },
  },
  PoultryFlock: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      name: { type: 'string' },
      birdType: { type: 'string', enum: birdTypeEnum },
      birdCount: { type: 'integer', minimum: 0 },
      arrivalDate: { type: 'string', format: 'date' },
      status: { type: 'string', enum: flockStatusEnum },
      notes: { type: 'string', nullable: true },
      createdByUserId: { type: 'string', format: 'uuid', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreatePoultryFlockRequest: {
    type: 'object',
    required: ['name', 'birdType', 'birdCount', 'arrivalDate'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      birdType: { type: 'string', enum: birdTypeEnum },
      birdCount: { type: 'integer', minimum: 0 },
      arrivalDate: { type: 'string', format: 'date', description: 'YYYY-MM-DD, not in the future' },
      notes: { type: 'string', maxLength: 4000, nullable: true },
    },
  },
  UpdatePoultryFlockRequest: {
    type: 'object',
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      birdType: { type: 'string', enum: birdTypeEnum },
      birdCount: { type: 'integer', minimum: 0 },
      arrivalDate: { type: 'string', format: 'date' },
      status: { type: 'string', enum: flockStatusEnum },
      notes: { type: 'string', maxLength: 4000, nullable: true },
    },
  },
};

const flocksBase = '/organizations/{organizationId}/poultry/flocks';

const paths: Obj = {
  '/organizations/farms': {
    post: {
      tags: ['Farms · Join'],
      summary: 'Add a poultry farm (domain-specific creation form)',
      description:
        'Any ACTIVE user — a Pet Owner included — creates their own poultry farm. Reuses the ' +
        'organization creation use case: one transaction creates the FARM organization, its ' +
        '`farm_details` row (with every submitted field), and the caller’s OWNER membership; ' +
        'the org starts PENDING. No new global role — ownership is the organization OWNER role. ' +
        'Only CLINIC still requires an approved-vet owner.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateFarmRequest' } },
        },
      },
      responses: {
        '201': ok(
          'Farm created (PENDING)',
          dataOf({
            type: 'object',
            description: 'The created organization + its `details` (incl. `joinCode`).',
            properties: { id: uuid, type: { type: 'string' }, name: { type: 'string' } },
          }),
        ),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/organizations/join': {
    post: {
      tags: ['Farms · Join'],
      summary: 'Join a farm with its Farm-ID / join code',
      description:
        'The caller must be an APPROVED veterinarian. No invitation / acceptance / admin ' +
        'approval — submitting the code creates (or reactivates a LEFT) VETERINARIAN membership ' +
        'in one transaction. Idempotent: an existing ACTIVE member gets `200` with the current ' +
        'membership. The farm must be ACTIVE. Organization id is never taken from the body.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/FarmJoinRequest' } },
        },
      },
      responses: {
        '201': ok('Joined', dataOf({ $ref: '#/components/schemas/OrganizationMembership' })),
        '200': ok(
          'Already a member',
          dataOf({ $ref: '#/components/schemas/OrganizationMembership' }),
        ),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/join-code': {
    get: {
      tags: ['Farms · Join'],
      summary: 'Read this farm’s current join code',
      description: 'FARM organizations only. Requires `organization.update` (OWNER via override).',
      security: bearer,
      parameters: [orgIdParam],
      responses: {
        '200': ok('Join code', dataOf({ $ref: '#/components/schemas/FarmJoinCode' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/join-code/regenerate': {
    post: {
      tags: ['Farms · Join'],
      summary: 'Rotate this farm’s join code',
      description:
        'FARM organizations only. Requires `organization.update`. The previous code stops ' +
        'working immediately. Audited.',
      security: bearer,
      parameters: [orgIdParam],
      responses: {
        '200': ok('New join code', dataOf({ $ref: '#/components/schemas/FarmJoinCode' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },

  [flocksBase]: {
    get: {
      tags: ['Farms · Poultry'],
      summary: 'List this farm’s poultry flocks',
      description: 'Requires `farm.poultry.read`. `status` / `birdType` query filters.',
      security: bearer,
      parameters: [
        orgIdParam,
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string', enum: flockStatusEnum } },
        { name: 'birdType', in: 'query', schema: { type: 'string', enum: birdTypeEnum } },
      ],
      responses: {
        '200': ok('Paginated flocks', listOf('#/components/schemas/PoultryFlock')),
        ...errs(400, 401, 403),
      },
    },
    post: {
      tags: ['Farms · Poultry'],
      summary: 'Register a poultry flock for this farm',
      description:
        'Requires `farm.poultry.create`. The organization must be a FARM. The recording user ' +
        'and organization are taken from the server, never the body.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePoultryFlockRequest' },
          },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/PoultryFlock' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  [`${flocksBase}/{flockId}`]: {
    get: {
      tags: ['Farms · Poultry'],
      summary: 'Get one poultry flock',
      description: 'Requires `farm.poultry.read`. A flock id not under this farm returns 404.',
      security: bearer,
      parameters: [orgIdParam, flockIdParam],
      responses: {
        '200': ok('Flock', dataOf({ $ref: '#/components/schemas/PoultryFlock' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Farms · Poultry'],
      summary: 'Update a poultry flock',
      description:
        'Requires `farm.poultry.update`. Content edits require the flock to be ACTIVE; a ' +
        'status-only change may re-open a CLOSED flock.',
      security: bearer,
      parameters: [orgIdParam, flockIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdatePoultryFlockRequest' },
          },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/PoultryFlock' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Farms · Poultry'],
      summary: 'Delete a poultry flock',
      description: 'Requires `farm.poultry.delete`. Audited.',
      security: bearer,
      parameters: [orgIdParam, flockIdParam],
      responses: { '200': ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
};

const tags = [
  {
    name: 'Farms · Join',
    description: 'Farm-ID / join-code flow (multi-farm veterinarian membership)',
  },
  { name: 'Farms · Poultry', description: 'Poultry flock CRUD, scoped to one FARM organization' },
];

export const phase6OpenApi = { tags, paths, schemas };
