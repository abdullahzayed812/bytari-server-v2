/**
 * OpenAPI fragments for Phase 10: the Veterinary Store product catalog and
 * the Veterinary Office product catalog. These are two fully independent
 * domains — separate tables (`veterinary_store_products` /
 * `veterinary_office_products`), separate route segments
 * (`/store-products` / `/office-products`), separate schemas. Nothing here
 * is shared beyond this file's doc-generation helpers (not business logic).
 *
 * Each is organization-scoped and gated by:
 *
 *   authenticate → withOrganization → withVeterinaryStore|withVeterinaryOffice (400 if wrong org type)
 *                → authorizeOrg(<product permission>) → [withProduct for :productId]
 *
 * Management routes are private to the organization's members. The
 * `/organizations/discover/{organizationId}/store-products*` /
 * `.../office-products*` routes are the public counterpart — any
 * authenticated user, ACTIVE organization + ACTIVE products only, same
 * visibility rule as `/organizations/discover/{id}`.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(kindLabel: string, ...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: `Malformed request (e.g. the organization is not a ${kindLabel})`,
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the organization permission (or organization not ACTIVE)',
    404: `Product not found, or not visible to the caller (belongs to another ${kindLabel})`,
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
const statusEnum = ['ACTIVE', 'INACTIVE'];
const detailFieldSchema = { type: 'string', minLength: 1, maxLength: 300, nullable: true };

interface Kind {
  /** e.g. "VeterinaryStore" — used to build schema/tag/path names. */
  name: 'VeterinaryStore' | 'VeterinaryOffice';
  /** e.g. "store-products" — the URL path segment. */
  pathSegment: string;
  /** e.g. "VETERINARY_STORE" — for error-message wording. */
  orgTypeLabel: string;
  /** e.g. "store/office" style label used in generic descriptions. */
  shortLabel: string;
}

const KINDS: Kind[] = [
  {
    name: 'VeterinaryStore',
    pathSegment: 'store-products',
    orgTypeLabel: 'VETERINARY_STORE',
    shortLabel: 'store',
  },
  {
    name: 'VeterinaryOffice',
    pathSegment: 'office-products',
    orgTypeLabel: 'VETERINARY_OFFICE',
    shortLabel: 'office',
  },
];

function buildSchemas(k: Kind): Obj {
  return {
    [`${k.name}ProductImage`]: {
      type: 'object',
      properties: {
        id: uuid,
        url: { type: 'string' },
        sortOrder: { type: 'integer' },
      },
    },
    [`${k.name}Product`]: {
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
        subtype: detailFieldSchema,
        weight: detailFieldSchema,
        usageInstructions: detailFieldSchema,
        dosage: detailFieldSchema,
        shelfLife: detailFieldSchema,
        manufacturer: detailFieldSchema,
        highlights: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        primaryImageUrl: { type: 'string', nullable: true },
        images: { type: 'array', items: { $ref: `#/components/schemas/${k.name}ProductImage` } },
        createdByUserId: { type: 'string', format: 'uuid', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
    [`Create${k.name}ProductRequest`]: {
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
        subtype: detailFieldSchema,
        weight: detailFieldSchema,
        usageInstructions: detailFieldSchema,
        dosage: detailFieldSchema,
        shelfLife: detailFieldSchema,
        manufacturer: detailFieldSchema,
        highlights: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 6 },
      },
    },
    [`Update${k.name}ProductRequest`]: {
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
    [`Adjust${k.name}StockRequest`]: {
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
    [`${k.name}ProductImageUploadUrlRequest`]: {
      type: 'object',
      required: ['filename', 'mimeType', 'size'],
      properties: {
        filename: { type: 'string', minLength: 1, maxLength: 255 },
        mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
        size: { type: 'integer', minimum: 1, description: 'Bytes; max 10 MiB' },
      },
    },
    [`${k.name}ProductImageUploadUrlResponse`]: {
      type: 'object',
      properties: {
        storageKey: { type: 'string' },
        uploadUrl: { type: 'string' },
        method: { type: 'string', enum: ['PUT'] },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        expiresInSeconds: { type: 'integer' },
      },
    },
    [`Finalize${k.name}ProductImageRequest`]: {
      type: 'object',
      required: ['storageKey', 'mimeType'],
      properties: {
        storageKey: { type: 'string' },
        mimeType: { type: 'string' },
      },
    },
  };
}

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

function buildPaths(k: Kind): Obj {
  const tag = `${k.name === 'VeterinaryStore' ? 'Veterinary Store' : 'Veterinary Office'} · Products`;
  const base = `/organizations/{organizationId}/${k.pathSegment}`;
  const discoverBase = `/organizations/discover/{organizationId}/${k.pathSegment}`;
  const productSchema = `#/components/schemas/${k.name}Product`;

  return {
    [base]: {
      get: {
        tags: [tag],
        summary: `List this ${k.shortLabel}'s products (management)`,
        description:
          'Requires `product.read`. Filters: `status`, `type`, `search` (name substring). ' +
          'Sort: `sort=name|price|createdAt`, `order=asc|desc` (default `createdAt` desc).',
        security: bearer,
        parameters: listParams([
          { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
        ]),
        responses: {
          '200': ok('Paginated products', listOf(productSchema)),
          ...errs(k.orgTypeLabel, 400, 401, 403, 422),
        },
      },
      post: {
        tags: [tag],
        summary: `Add a product to this ${k.shortLabel}`,
        description: `Requires \`product.create\`. The organization must be a ${k.orgTypeLabel}.`,
        security: bearer,
        parameters: [orgIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/Create${k.name}ProductRequest` },
            },
          },
        },
        responses: {
          '201': ok('Created', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 422),
        },
      },
    },
    [`${base}/{productId}`]: {
      get: {
        tags: [tag],
        summary: 'Get one product (management)',
        description: 'Requires `product.read`. A product id not under this organization returns 404.',
        security: bearer,
        parameters: [orgIdParam, productIdParam],
        responses: {
          '200': ok('Product', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404),
        },
      },
      patch: {
        tags: [tag],
        summary: "Update a product's profile fields / status",
        description:
          'Requires `product.update`. Cannot change `organizationId` or `stockQuantity` ' +
          '(stock has its own endpoint).',
        security: bearer,
        parameters: [orgIdParam, productIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/Update${k.name}ProductRequest` },
            },
          },
        },
        responses: {
          '200': ok('Updated', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404, 422),
        },
      },
      delete: {
        tags: [tag],
        summary: 'Deactivate (soft-delete) a product',
        description:
          'Requires `product.delete`. Sets `status = INACTIVE`; idempotent. Products are never ' +
          'physically deleted (future Orders will reference product history).',
        security: bearer,
        parameters: [orgIdParam, productIdParam],
        responses: {
          '200': ok('Deactivated', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404),
        },
      },
    },
    [`${base}/{productId}/stock`]: {
      post: {
        tags: [tag],
        summary: "Adjust a product's stock by a signed delta",
        description:
          'Requires `product.inventory.adjust` (a permission distinct from `product.update`). ' +
          'The resulting quantity may not be negative (409 otherwise). Audited as ' +
          `\`${k.orgTypeLabel}_PRODUCT_INVENTORY_ADJUSTED\` with the previous / new quantity.`,
        security: bearer,
        parameters: [orgIdParam, productIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/Adjust${k.name}StockRequest` },
            },
          },
        },
        responses: {
          '200': ok('Updated product', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404, 409, 422),
        },
      },
    },
    [`${base}/{productId}/images/upload-url`]: {
      post: {
        tags: [tag],
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
              schema: { $ref: `#/components/schemas/${k.name}ProductImageUploadUrlRequest` },
            },
          },
        },
        responses: {
          '200': ok(
            'Presigned upload',
            dataOf({ $ref: `#/components/schemas/${k.name}ProductImageUploadUrlResponse` }),
          ),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404, 409, 422),
        },
      },
    },
    [`${base}/{productId}/images`]: {
      post: {
        tags: [tag],
        summary: 'Register an uploaded product image',
        description:
          'Requires `product.update`. Confirms the object exists at `storageKey` (from the ' +
          'upload-url step) before recording it. The first image becomes the primary image.',
        security: bearer,
        parameters: [orgIdParam, productIdParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/Finalize${k.name}ProductImageRequest` },
            },
          },
        },
        responses: {
          '200': ok('Updated product', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404, 422),
        },
      },
    },
    [`${base}/{productId}/images/{imageId}`]: {
      delete: {
        tags: [tag],
        summary: 'Remove a product image',
        description:
          'Requires `product.update`. If the removed image was the primary image, the next ' +
          'remaining image (by sort order) becomes primary.',
        security: bearer,
        parameters: [orgIdParam, productIdParam, imageIdParam],
        responses: {
          '200': ok('Updated product', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 400, 401, 403, 404),
        },
      },
    },
    [discoverBase]: {
      get: {
        tags: [tag],
        summary: `Browse a ${k.shortLabel}'s public product catalog`,
        description:
          'Any authenticated user, not just members. The organization must be ACTIVE and of ' +
          `type ${k.orgTypeLabel}; only ACTIVE products are returned.`,
        security: bearer,
        parameters: listParams(),
        responses: {
          '200': ok('Paginated products', listOf(productSchema)),
          ...errs(k.orgTypeLabel, 401, 404, 422),
        },
      },
    },
    [`${discoverBase}/{productId}`]: {
      get: {
        tags: [tag],
        summary: 'Get one product from the public catalog',
        description:
          `Any authenticated user. 404 if the organization is not ACTIVE / not ${k.orgTypeLabel}, ` +
          'or the product is not ACTIVE.',
        security: bearer,
        parameters: [orgIdParam, productIdParam],
        responses: {
          '200': ok('Product', dataOf({ $ref: productSchema })),
          ...errs(k.orgTypeLabel, 401, 404),
        },
      },
    },
  };
}

const schemas: Obj = KINDS.reduce((acc, k) => ({ ...acc, ...buildSchemas(k) }), {});
const paths: Obj = KINDS.reduce((acc, k) => ({ ...acc, ...buildPaths(k) }), {});

const tags = [
  {
    name: 'Veterinary Store · Products',
    description:
      'Product CRUD + inventory + images for VETERINARY_STORE organizations only, in their own ' +
      '`veterinary_store_products` table, plus the public catalog browse under /organizations/discover',
  },
  {
    name: 'Veterinary Office · Products',
    description:
      'Product CRUD + inventory + images for VETERINARY_OFFICE organizations only, in their own ' +
      '`veterinary_office_products` table, plus the public catalog browse under /organizations/discover',
  },
];

export const phase10OpenApi = { tags, paths, schemas };
