/**
 * OpenAPI fragments for Phase 4 (Animal Core + Animal Ownership). Merged into
 * the base document by `buildOpenApiDocument`.
 *
 * Access to an individual animal is OWNERSHIP-scoped: the current owner (the one
 * open row in `animal_ownerships`) or an ADMIN. Cross-user access is hidden as
 * `404` rather than `403`. The initial owner is always the creator — the client
 * cannot choose it — and ownership is only ever moved via the transfer endpoint.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. transfer target is not an active user)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but not permitted',
    404: 'Animal not found, or not visible to the caller',
    409: 'Conflict with current state (animal deactivated, target already the owner, concurrent transfer)',
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

const animalIdParam = {
  name: 'animalId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const speciesEnum = ['DOG', 'CAT', 'BIRD', 'RABBIT', 'REPTILE', 'FISH', 'HORSE', 'OTHER'];
const sexEnum = ['MALE', 'FEMALE', 'UNKNOWN'];
const statusEnum = ['ACTIVE', 'DEACTIVATED'];

const schemas: Obj = {
  Animal: {
    type: 'object',
    description: 'Client-safe animal. The current owner is resolved from the ownership history.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      species: { type: 'string', enum: speciesEnum },
      breed: { type: 'string', nullable: true },
      sex: { type: 'string', enum: sexEnum },
      dateOfBirth: { type: 'string', format: 'date', nullable: true },
      notes: { type: 'string', nullable: true },
      status: { type: 'string', enum: statusEnum },
      createdBy: { type: 'string', format: 'uuid' },
      currentOwnerUserId: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  OwnershipRecord: {
    type: 'object',
    description: 'One interval in an animal’s ownership history. Append-only.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      animalId: { type: 'string', format: 'uuid' },
      ownerUserId: { type: 'string', format: 'uuid' },
      owner: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: 'string', format: 'date-time', nullable: true },
      isCurrent: { type: 'boolean' },
      transferredBy: { type: 'string', format: 'uuid', nullable: true },
      transferReason: { type: 'string', nullable: true },
    },
  },
  CreateAnimalRequest: {
    type: 'object',
    required: ['name', 'species'],
    description:
      'Owner-selecting and system fields (ownerId, ownershipId, status, createdBy, …) are ignored if supplied.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      species: { type: 'string', enum: speciesEnum },
      breed: { type: 'string', minLength: 1, maxLength: 120 },
      sex: { type: 'string', enum: sexEnum },
      dateOfBirth: {
        type: 'string',
        format: 'date',
        description: 'YYYY-MM-DD; not in the future',
      },
      notes: { type: 'string', maxLength: 2000 },
    },
  },
  UpdateAnimalRequest: {
    type: 'object',
    minProperties: 1,
    description:
      'Profile fields only. Ownership and status are never changed through this endpoint.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      species: { type: 'string', enum: speciesEnum },
      breed: { type: 'string', minLength: 1, maxLength: 120, nullable: true },
      sex: { type: 'string', enum: sexEnum },
      dateOfBirth: { type: 'string', format: 'date', nullable: true },
      notes: { type: 'string', maxLength: 2000, nullable: true },
    },
  },
  TransferOwnershipRequest: {
    type: 'object',
    required: ['toUserId'],
    description:
      'The current owner is taken from the server, never the request body. `toUserId` must be an existing active user who is not already the current owner.',
    properties: {
      toUserId: { type: 'string', format: 'uuid' },
      reason: { type: 'string', maxLength: 500 },
    },
  },
};

const paths: Obj = {
  '/animals': {
    post: {
      tags: ['Animals'],
      summary: 'Create an animal (the authenticated caller becomes the owner)',
      description:
        'Any authenticated, active user may create an animal. No admin approval. An initial ' +
        '`animal_ownerships` row for the caller is created in the same transaction.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateAnimalRequest' } },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 403, 422),
      },
    },
    get: {
      tags: ['Animals'],
      summary: 'List animals the caller currently owns',
      description: 'Owner-scoped. Never returns animals owned by other users (ADMIN included).',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
        { name: 'species', in: 'query', schema: { type: 'string', enum: speciesEnum } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': ok('Paginated animals', {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Animal' } },
            meta: { type: 'object' },
          },
        }),
        ...errs(401, 422),
      },
    },
  },
  '/animals/{animalId}': {
    get: {
      tags: ['Animals'],
      summary: 'Get one animal (current owner or ADMIN)',
      security: bearer,
      parameters: [animalIdParam],
      responses: {
        '200': ok('Animal', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 404),
      },
    },
    patch: {
      tags: ['Animals'],
      summary: 'Update an animal’s profile (current owner or ADMIN)',
      description: 'The animal must be ACTIVE. Ownership and status are not affected.',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateAnimalRequest' } },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Animals'],
      summary: 'Deactivate an animal (current owner or ADMIN)',
      description:
        'Soft delete: sets `status=DEACTIVATED`. Idempotent. Ownership history is preserved.',
      security: bearer,
      parameters: [animalIdParam],
      responses: {
        '200': ok('Deactivated', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/ownership/transfer': {
    post: {
      tags: ['Animals · Ownership'],
      summary: 'Transfer ownership to another user (current owner or ADMIN)',
      description:
        'Closes the current ownership interval and opens a new one for `toUserId` in a single ' +
        'transaction. The animal must be ACTIVE; the target must be an existing active user and ' +
        'not the current owner.',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/TransferOwnershipRequest' } },
        },
      },
      responses: {
        '200': ok(
          'New current ownership record',
          dataOf({ $ref: '#/components/schemas/OwnershipRecord' }),
        ),
        ...errs(400, 401, 404, 409, 422),
      },
    },
  },
  '/animals/{animalId}/ownership/history': {
    get: {
      tags: ['Animals · Ownership'],
      summary: 'Full ownership history for an animal (current owner or ADMIN)',
      description: 'Oldest interval first. Exactly one record has `isCurrent=true`.',
      security: bearer,
      parameters: [animalIdParam],
      responses: {
        '200': ok('Ownership history', {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/OwnershipRecord' } },
          },
        }),
        ...errs(401, 404),
      },
    },
  },
};

const tags = [
  { name: 'Animals', description: 'Animal Core — create, read, update, deactivate (owner-scoped)' },
  {
    name: 'Animals · Ownership',
    description: 'Ownership transfer and complete ownership history',
  },
];

export const phase4OpenApi = { tags, paths, schemas };
