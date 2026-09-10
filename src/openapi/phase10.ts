/**
 * OpenAPI fragments for Phase 10 (Veterinary Store & Products), extended to
 * Veterinary Offices (Veterinarian Home → "المكاتب البيطرية"). Merged into the
 * base document by `buildOpenApiDocument`.
 *
 * A product-owning organization is a VETERINARY_STORE or VETERINARY_OFFICE
 * (Phase 3) — its creation / approval / profile / members / supervisors are
 * the Phase 3 organization endpoints. This module adds only product
 * management. Every management route is organization-scoped and gated by:
 *
 *   authenticate → withOrganization → withProductOrganization (400 if not store/office)
 *                → authorizeOrg(<product permission>) → [withProduct for :productId]
 *
 * Management routes are private to the organization's members. The
 * `/organizations/discover/{organizationId}/products*` routes are the public
 * counterpart — any authenticated user, ACTIVE organization + ACTIVE products
 * only, same visibility rule as `/organizations/discover/{id}`.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. the organization is not a VETERINARY_STORE / VETERINARY_OFFICE)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the organization permission (or organization not ACTIVE)',
    404: 'Product not found, or not visible to the caller (belongs to another store/office)',
    409: 'Conflict with current state (stock adjustment would go below zero, image limit reached)',
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
const imageIdParam = { name: 'imageId', in: 'path', required: true, schema: uuid };
const typeEnum = ['MEDICINE', 'EQUIPMENT_SUPPLY', 'SUPPLEMENT', 'CARE'];
const orgTypeEnum = ['VETERINARY_STORE', 'VETERINARY_OFFICE'];
const statusEnum = ['ACTIVE', 'INACTIVE'];
const detailFieldSchema = { type: 'string', minLength: 1, maxLength: 300, nullable: true };

const schemas: Obj = {
  ProductImage: {
    type: 'object',
    properties: {
      id: uuid,
      url: { type: 'string' },
      sortOrder: { type: 'integer' },
    },
  },
  Product: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      organizationType: { type: 'string', enum: orgTypeEnum },
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
      subtype: detailFieldSchema,
      weight: detailFieldSchema,
      usageInstructions: detailFieldSchema,
      dosage: detailFieldSchema,
      shelfLife: detailFieldSchema,
      manufacturer: detailFieldSchema,
      highlights: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      primaryImageUrl: { type: 'string', nullable: true },
      images: { type: 'array', items: { $ref: '#/components/schemas/ProductImage' } },
      createdByUserId: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateProductRequest: {
    type: 'object',
    required: ['name', 'productType'],
    description:
      '`organizationId` / `organizationType` come from the URL; `createdBy` / `status` / ' +
      '`stockQuantity` after creation are server-controlled. `stockQuantity` here is the ' +
      'opening stock only.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 },
      description: { type: 'string', minLength: 1, maxLength: 4000, nullable: true },
      productType: { type: 'string', enum: typeEnum },
      price: { type: 'string', pattern: '^\\d{1,8}(\\.\\d{1,2})?$', nullable: true },
      stockQuantity: { type: 'integer', minimum: 0 },
      subtype: detailFieldSchema,
      weight: detailFieldSchema,
      usageInstructions: detailFieldSchema,
      dosage: detailFieldSchema,
      shelfLife: detailFieldSchema,
      manufacturer: detailFieldSchema,
      highlights: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 6 },
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
      subtype: detailFieldSchema,
      weight: detailFieldSchema,
      usageInstructions: detailFieldSchema,
      dosage: detailFieldSchema,
      shelfLife: detailFieldSchema,
      manufacturer: detailFieldSchema,
      highlights: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 6 },
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
  ProductImageUploadUrlRequest: {
    type: 'object',
    required: ['filename', 'mimeType', 'size'],
    properties: {
      filename: { type: 'string', minLength: 1, maxLength: 255 },
      mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
      size: { type: 'integer', minimum: 1, description: 'Bytes; max 10 MiB' },
    },
  },
  ProductImageUploadUrlResponse: {
    type: 'object',
    properties: {
      storageKey: { type: 'string' },
      uploadUrl: { type: 'string' },
      method: { type: 'string', enum: ['PUT'] },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      expiresInSeconds: { type: 'integer' },
    },
  },
  FinalizeProductImageRequest: {
    type: 'object',
    required: ['storageKey', 'mimeType'],
    properties: {
      storageKey: { type: 'string' },
      mimeType: { type: 'string' },
    },
  },
};

const base = '/organizations/{organizationId}/products';
const discoverBase = '/organizations/discover/{organizationId}/products';

const listParams = (extra: Obj[] = []): Obj[] => [
  orgIdParam,
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  { name: 'type', in: 'query', schema: { type: 'string', enum: typeEnum } },
  { name: 'search', in: 'query', schema: { type: 'string' } },
  { name: 'sort', in: 'query', schema: { type: 'string', enum: ['name', 'price', 'createdAt'] } },
  { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
  ...extra,
];

const paths: Obj = {
  [base]: {
    get: {
      tags: ['Veterinary Store · Products'],
      summary: 'List this organization’s products (management)',
      description:
        'Requires `product.read`. Filters: `status`, `type`, `search` (name substring). ' +
        'Sort: `sort=name|price|createdAt`, `order=asc|desc` (default `createdAt` desc).',
      security: bearer,
      parameters: listParams([
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
      ]),
      responses: {
        '200': ok('Paginated products', listOf('#/components/schemas/Product')),
        ...errs(400, 401, 403, 422),
      },
    },
    post: {
      tags: ['Veterinary Store · Products'],
      summary: 'Add a product to this store/office',
      description:
        'Requires `product.create`. The organization must be a VETERINARY_STORE or VETERINARY_OFFICE.',
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
      summary: 'Get one product (management)',
      description: 'Requires `product.read`. A product id not under this organization returns 404.',
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
  [`${base}/{productId}/images/upload-url`]: {
    post: {
      tags: ['Veterinary Store · Products'],
      summary: 'Request a presigned upload URL for a product image',
      description:
        'Requires `product.update`. Max 6 images per product, 10 MiB each, PNG/JPEG/WebP only. ' +
        'Direct-to-R2 PUT — storage credentials never reach the client.',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ProductImageUploadUrlRequest' },
          },
        },
      },
      responses: {
        '200': ok('Presigned upload', dataOf({ $ref: '#/components/schemas/ProductImageUploadUrlResponse' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  [`${base}/{productId}/images`]: {
    post: {
      tags: ['Veterinary Store · Products'],
      summary: 'Register an uploaded product image',
      description:
        'Requires `product.update`. Confirms the object exists at `storageKey` (from the ' +
        'upload-url step) before recording it. The first image becomes the primary image.',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/FinalizeProductImageRequest' } },
        },
      },
      responses: {
        '200': ok('Updated product', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  [`${base}/{productId}/images/{imageId}`]: {
    delete: {
      tags: ['Veterinary Store · Products'],
      summary: 'Remove a product image',
      description:
        'Requires `product.update`. If the removed image was the primary image, the next ' +
        'remaining image (by sort order) becomes primary.',
      security: bearer,
      parameters: [orgIdParam, productIdParam, imageIdParam],
      responses: {
        '200': ok('Updated product', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  [discoverBase]: {
    get: {
      tags: ['Veterinary Store · Products'],
      summary: 'Browse a store/office’s public product catalog',
      description:
        'Any authenticated user, not just members — the Veterinary Offices product screens. ' +
        'The organization must be ACTIVE and product-capable; only ACTIVE products are returned.',
      security: bearer,
      parameters: listParams(),
      responses: {
        '200': ok('Paginated products', listOf('#/components/schemas/Product')),
        ...errs(401, 404, 422),
      },
    },
  },
  [`${discoverBase}/{productId}`]: {
    get: {
      tags: ['Veterinary Store · Products'],
      summary: 'Get one product from the public catalog',
      description:
        'Any authenticated user. 404 if the organization is not ACTIVE / not product-capable, ' +
        'or the product is not ACTIVE.',
      security: bearer,
      parameters: [orgIdParam, productIdParam],
      responses: {
        '200': ok('Product', dataOf({ $ref: '#/components/schemas/Product' })),
        ...errs(401, 404),
      },
    },
  },
};

const tags = [
  {
    name: 'Veterinary Store · Products',
    description:
      'Product CRUD + inventory + images for VETERINARY_STORE / VETERINARY_OFFICE organizations, ' +
      'plus the public catalog browse under /organizations/discover',
  },
];

export const phase10OpenApi = { tags, paths, schemas };
