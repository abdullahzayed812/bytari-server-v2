/**
 * OpenAPI fragments for Phase 10 (Veterinary Store & Products). Merged into the
 * base document by `buildOpenApiDocument`.
 *
 * A Veterinary Store is an Organization of type `VETERINARY_STORE` (Phase 3) —
 * its creation / approval / profile / members / supervisors are the Phase 3
 * organization endpoints. Phase 10 adds only product management. Every route is
 * organization-scoped and gated by:
 *
 *   authenticate → withOrganization → withVeterinaryStore (400 if not a store)
 *                → authorizeOrg(<product permission>) → [withProduct for :productId]
 *
 * Products are private to the store's members. There is no public browse.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. the organization is not a VETERINARY_STORE)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the organization permission (or organization not ACTIVE)',
    404: 'Product not found, or not visible to the caller (belongs to another store)',
    409: 'Conflict with current state (stock adjustment would go below zero)',
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
const productIdParam = { name: 'productId', in: 'path', required: true, schema: uuid };
const typeEnum = ['MEDICINE', 'EQUIPMENT', 'SUPPLY', 'OTHER'];
const statusEnum = ['ACTIVE', 'INACTIVE'];

const schemas: Obj = {
  Product: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      productType: { type: 'string', enum: typeEnum },
      price: {
        type: 'string',
        nullable: true,
        description: 'Decimal string (numeric(12,2)); never a float. e.g. "12.50"',
      },
      stockQuantity: { type: 'integer', minimum: 0 },
      status: { type: 'string', enum: statusEnum },
      createdByUserId: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateProductRequest: {
    type: 'object',
    required: ['name', 'productType'],
    description:
      '`organizationId` comes from the URL; `createdBy` / `status` / `stockQuantity` after ' +
      'creation are server-controlled. `stockQuantity` here is the opening stock only.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 4000, nullable: true },
      productType: { type: 'string', enum: typeEnum },
      price: { type: 'string', pattern: '^\\d{1,8}(\\.\\d{1,2})?$', nullable: true },
      stockQuantity: { type: 'integer', minimum: 0 },
    },
  },
  UpdateProductRequest: {
    type: 'object',
    minProperties: 1,
    description: 'Profile fields + `status` only. Stock is changed via the stock endpoint.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', nullable: true },
      productType: { type: 'string', enum: typeEnum },
      price: { type: 'string', pattern: '^\\d{1,8}(\\.\\d{1,2})?$', nullable: true },
      status: { type: 'string', enum: statusEnum },
    },
  },
  AdjustStockRequest: {
    type: 'object',
    required: ['delta'],
    properties: {
      delta: {
        type: 'integer',
        description: 'Signed, non-zero. The resulting stock may not be negative.',
      },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
};

const base = '/organizations/{organizationId}/products';

const paths: Obj = {
  [base]: {
    get: {
      tags: ['Veterinary Store · Products'],
      summary: 'List this store’s products',
      description:
        'Requires `product.read`. Filters: `status`, `type`, `search` (name substring). ' +
        'Sort: `sort=name|price|createdAt`, `order=asc|desc` (default `createdAt` desc).',
      security: bearer,
      parameters: [
        orgIdParam,
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
        { name: 'type', in: 'query', schema: { type: 'string', enum: typeEnum } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        {
          name: 'sort',
          in: 'query',
          schema: { type: 'string', enum: ['name', 'price', 'createdAt'] },
        },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ],
      responses: {
        '200': ok('Paginated products', listOf('#/components/schemas/Product')),
        ...errs(400, 401, 403, 422),
      },
    },
    post: {
      tags: ['Veterinary Store · Products'],
      summary: 'Add a product to this store',
      description: 'Requires `product.create`. The organization must be a VETERINARY_STORE.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateProductRequest' } },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  [`${base}/{productId}`]: {
    get: {
      tags: ['Veterinary Store · Products'],
      summary: 'Get one product',
      description: 'Requires `product.read`. A product id not under this store returns 404.',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      responses: {
        '200': ok('Product', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 404),
      },
    },
    patch: {
      tags: ['Veterinary Store · Products'],
      summary: 'Update a product’s profile fields / status',
      description:
        'Requires `product.update`. Cannot change `organizationId` or `stockQuantity` ' +
        '(stock has its own endpoint).',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateProductRequest' } },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Veterinary Store · Products'],
      summary: 'Deactivate (soft-delete) a product',
      description:
        'Requires `product.delete`. Sets `status = INACTIVE`; idempotent. Products are never ' +
        'physically deleted (future Orders will reference product history).',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      responses: {
        '200': ok('Deactivated', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  [`${base}/{productId}/stock`]: {
    post: {
      tags: ['Veterinary Store · Products'],
      summary: 'Adjust a product’s stock by a signed delta',
      description:
        'Requires `product.inventory.adjust` (a permission distinct from `product.update`). ' +
        'The resulting quantity may not be negative (409 otherwise). Audited as ' +
        '`PRODUCT_INVENTORY_ADJUSTED` with the previous / new quantity.',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/AdjustStockRequest' } },
        },
      },
      responses: {
        '200': ok('Updated product', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
};

const tags = [
  {
    name: 'Veterinary Store · Products',
    description: 'Product CRUD + inventory for VETERINARY_STORE organizations',
  },
];

export const phase10OpenApi = { tags, paths, schemas };
