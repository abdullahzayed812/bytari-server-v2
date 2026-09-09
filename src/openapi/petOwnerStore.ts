/**
 * OpenAPI fragments for the Pet Owners Store — a platform-run consumer
 * storefront with dedicated `pet_owner_store_*` tables. Consumer browse / cart /
 * checkout / order history need only authentication; `/admin/pet-owner-store/*`
 * management needs `pet_store.*` (ADMIN override or a PET_OWNER_STORE
 * system-supervisor). Product / category images use the shared presigned-R2 flow.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (empty cart, non-COD payment method, unknown category)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the required pet_store.* permission',
    404: 'Resource not found (or not ACTIVE for a consumer read; another user’s cart item / order)',
    409: 'Conflict (insufficient stock, invalid order-status transition, image cap)',
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
const money = { type: 'string', description: 'Decimal string, numeric(12,2). Never a float.' };

const tags = [
  {
    name: 'Pet Owners Store',
    description: 'Consumer storefront — catalogue, cart, checkout, orders.',
  },
  { name: 'Pet Owners Store (Admin)', description: 'Catalogue + order management (pet_store.*).' },
];

const schemas: Obj = {
  PetStoreCategory: {
    type: 'object',
    properties: {
      id: uuid,
      slug: { type: 'string' },
      name: { type: 'string' },
      imageUrl: { type: 'string', nullable: true },
      showOnHome: { type: 'boolean' },
      sortOrder: { type: 'integer' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
      productCount: { type: 'integer' },
    },
  },
  PetStoreProductListItem: {
    type: 'object',
    properties: {
      id: uuid,
      categoryId: { ...uuid, nullable: true },
      categoryName: { type: 'string', nullable: true },
      name: { type: 'string' },
      price: money,
      currency: { type: 'string' },
      inStock: { type: 'boolean' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
      primaryImageUrl: { type: 'string', nullable: true },
      ratingAverage: { type: 'string', nullable: true },
      ratingCount: { type: 'integer' },
    },
  },
  PetStoreProductDetail: {
    allOf: [
      { $ref: '#/components/schemas/PetStoreProductListItem' },
      {
        type: 'object',
        properties: {
          description: { type: 'string', nullable: true },
          stockQuantity: { type: 'integer' },
          attributes: { type: 'object', additionalProperties: { type: 'string' }, nullable: true },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: uuid, url: { type: 'string' }, sortOrder: { type: 'integer' } },
            },
          },
        },
      },
    ],
  },
  PetStoreCart: {
    type: 'object',
    properties: {
      id: uuid,
      itemCount: { type: 'integer' },
      subtotalAmount: money,
      deliveryFee: money,
      totalAmount: money,
      currency: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: uuid,
            productId: uuid,
            name: { type: 'string' },
            primaryImageUrl: { type: 'string', nullable: true },
            unitPrice: money,
            quantity: { type: 'integer' },
            lineTotal: money,
            inStock: { type: 'boolean' },
            availableStock: { type: 'integer' },
          },
        },
      },
    },
  },
  PetStoreOrder: {
    type: 'object',
    properties: {
      id: uuid,
      orderNumber: { type: 'string' },
      userId: uuid,
      status: {
        type: 'string',
        enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
      },
      paymentMethod: { type: 'string', enum: ['COD', 'MADA', 'CREDIT_CARD'] },
      paymentStatus: { type: 'string', enum: ['UNPAID', 'PAID', 'REFUNDED'] },
      subtotalAmount: money,
      deliveryFee: money,
      totalAmount: money,
      currency: { type: 'string' },
      recipientName: { type: 'string' },
      recipientPhone: { type: 'string' },
      city: { type: 'string' },
      addressLine: { type: 'string' },
      note: { type: 'string', nullable: true },
      placedAt: { type: 'string', format: 'date-time' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: uuid,
            productId: { ...uuid, nullable: true },
            name: { type: 'string' },
            unitPrice: money,
            quantity: { type: 'integer' },
            lineTotal: money,
          },
        },
      },
    },
  },
  PetStoreAdminProduct: {
    allOf: [
      { $ref: '#/components/schemas/PetStoreProductDetail' },
      {
        type: 'object',
        properties: {
          createdByUserId: { ...uuid, nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    ],
  },
};

const uploadUrlResult = dataOf({
  type: 'object',
  properties: {
    storageKey: { type: 'string' },
    uploadUrl: { type: 'string' },
    method: { type: 'string', enum: ['PUT'] },
    headers: { type: 'object' },
    expiresInSeconds: { type: 'integer' },
  },
});

const paths: Obj = {
  // --- consumer ---------------------------------------------
  '/pet-owner-store/categories': {
    get: {
      tags: ['Pet Owners Store'],
      summary: 'List ACTIVE categories (optionally home tiles only)',
      security: bearer,
      parameters: [{ name: 'homeOnly', in: 'query', schema: { type: 'boolean' } }],
      responses: {
        200: ok(
          'Categories',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/PetStoreCategory' } }),
        ),
        ...errs(401),
      },
    },
  },
  '/pet-owner-store/products': {
    get: {
      tags: ['Pet Owners Store'],
      summary: 'List ACTIVE products (search / category filter / sort / paginate)',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        { name: 'categoryId', in: 'query', schema: uuid },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        {
          name: 'sort',
          in: 'query',
          schema: { type: 'string', enum: ['name', 'price', 'createdAt'] },
        },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ],
      responses: {
        200: ok('Products', listOf('#/components/schemas/PetStoreProductListItem')),
        ...errs(401, 422),
      },
    },
  },
  '/pet-owner-store/products/{productId}': {
    parameters: [{ name: 'productId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Pet Owners Store'],
      summary: 'Product detail (ACTIVE only)',
      security: bearer,
      responses: {
        200: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreProductDetail' })),
        ...errs(401, 404),
      },
    },
  },
  '/pet-owner-store/cart': {
    get: {
      tags: ['Pet Owners Store'],
      summary: "Get the caller's cart (created on first read)",
      security: bearer,
      responses: {
        200: ok('Cart', dataOf({ $ref: '#/components/schemas/PetStoreCart' })),
        ...errs(401),
      },
    },
    delete: {
      tags: ['Pet Owners Store'],
      summary: 'Empty the cart',
      security: bearer,
      responses: {
        200: ok('Cart', dataOf({ $ref: '#/components/schemas/PetStoreCart' })),
        ...errs(401),
      },
    },
  },
  '/pet-owner-store/cart/items': {
    post: {
      tags: ['Pet Owners Store'],
      summary: 'Add a product to the cart (quantity merges with any existing line)',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['productId'],
              properties: {
                productId: uuid,
                quantity: { type: 'integer', minimum: 1, maximum: 99 },
              },
            },
          },
        },
      },
      responses: {
        201: ok('Cart', dataOf({ $ref: '#/components/schemas/PetStoreCart' })),
        ...errs(401, 404, 409, 422),
      },
    },
  },
  '/pet-owner-store/cart/items/{itemId}': {
    parameters: [{ name: 'itemId', in: 'path', required: true, schema: uuid }],
    patch: {
      tags: ['Pet Owners Store'],
      summary: 'Set a line quantity',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['quantity'],
              properties: { quantity: { type: 'integer', minimum: 1, maximum: 99 } },
            },
          },
        },
      },
      responses: {
        200: ok('Cart', dataOf({ $ref: '#/components/schemas/PetStoreCart' })),
        ...errs(401, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Pet Owners Store'],
      summary: 'Remove a line',
      security: bearer,
      responses: {
        200: ok('Cart', dataOf({ $ref: '#/components/schemas/PetStoreCart' })),
        ...errs(401, 404),
      },
    },
  },
  '/pet-owner-store/orders': {
    post: {
      tags: ['Pet Owners Store'],
      summary: 'Checkout — place an order from the cart (Cash on Delivery)',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['paymentMethod', 'recipientName', 'recipientPhone', 'city', 'addressLine'],
              properties: {
                paymentMethod: { type: 'string', enum: ['COD', 'MADA', 'CREDIT_CARD'] },
                recipientName: { type: 'string' },
                recipientPhone: { type: 'string' },
                city: { type: 'string' },
                addressLine: { type: 'string' },
                note: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
      responses: {
        201: ok('Order', dataOf({ $ref: '#/components/schemas/PetStoreOrder' })),
        ...errs(400, 401, 409, 422),
      },
    },
    get: {
      tags: ['Pet Owners Store'],
      summary: "The caller's order history",
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        {
          name: 'status',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
          },
        },
      ],
      responses: { 200: ok('Orders', listOf('#/components/schemas/PetStoreOrder')), ...errs(401) },
    },
  },
  '/pet-owner-store/orders/{orderId}': {
    parameters: [{ name: 'orderId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Pet Owners Store'],
      summary: "One of the caller's orders",
      security: bearer,
      responses: {
        200: ok('Order', dataOf({ $ref: '#/components/schemas/PetStoreOrder' })),
        ...errs(401, 404),
      },
    },
  },

  // --- admin -----------------------------------------------
  '/admin/pet-owner-store/products': {
    get: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'List products (any status) — pet_store.product.manage',
      security: bearer,
      responses: {
        200: ok('Products', listOf('#/components/schemas/PetStoreAdminProduct')),
        ...errs(401, 403),
      },
    },
    post: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Create a product — pet_store.product.manage',
      security: bearer,
      responses: {
        201: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreAdminProduct' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/admin/pet-owner-store/products/{productId}': {
    parameters: [{ name: 'productId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Product preview — pet_store.product.manage',
      security: bearer,
      responses: {
        200: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreAdminProduct' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Update a product — pet_store.product.manage',
      security: bearer,
      responses: {
        200: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreAdminProduct' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Deactivate (soft-delete) a product — pet_store.product.manage',
      security: bearer,
      responses: {
        200: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreAdminProduct' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/pet-owner-store/products/{productId}/image/upload-url': {
    parameters: [{ name: 'productId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Request a presigned R2 upload URL for a product image',
      security: bearer,
      responses: { 200: ok('Upload URL', uploadUrlResult), ...errs(400, 401, 403, 404, 409, 422) },
    },
  },
  '/admin/pet-owner-store/products/{productId}/images': {
    parameters: [{ name: 'productId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Register an uploaded product image (first one becomes primary)',
      security: bearer,
      responses: {
        201: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreAdminProduct' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/pet-owner-store/products/{productId}/images/{imageId}': {
    parameters: [
      { name: 'productId', in: 'path', required: true, schema: uuid },
      { name: 'imageId', in: 'path', required: true, schema: uuid },
    ],
    delete: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Remove a product image',
      security: bearer,
      responses: {
        200: ok('Product', dataOf({ $ref: '#/components/schemas/PetStoreAdminProduct' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/pet-owner-store/categories': {
    get: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'List categories (any status) — pet_store.category.manage',
      security: bearer,
      responses: {
        200: ok(
          'Categories',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/PetStoreCategory' } }),
        ),
        ...errs(401, 403),
      },
    },
    post: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Create a category — pet_store.category.manage',
      security: bearer,
      responses: {
        201: ok('Category', dataOf({ $ref: '#/components/schemas/PetStoreCategory' })),
        ...errs(401, 403, 409, 422),
      },
    },
  },
  '/admin/pet-owner-store/categories/{categoryId}': {
    parameters: [{ name: 'categoryId', in: 'path', required: true, schema: uuid }],
    patch: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Update a category — pet_store.category.manage',
      security: bearer,
      responses: {
        200: ok('Category', dataOf({ $ref: '#/components/schemas/PetStoreCategory' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Delete a category (products keep, category_id nulled)',
      security: bearer,
      responses: { 204: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/admin/pet-owner-store/categories/{categoryId}/image/upload-url': {
    parameters: [{ name: 'categoryId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Request a presigned R2 upload URL for a category image',
      security: bearer,
      responses: { 200: ok('Upload URL', uploadUrlResult), ...errs(400, 401, 403, 404, 422) },
    },
  },
  '/admin/pet-owner-store/categories/{categoryId}/image': {
    parameters: [{ name: 'categoryId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Register / replace a category image',
      security: bearer,
      responses: {
        200: ok('Category', dataOf({ $ref: '#/components/schemas/PetStoreCategory' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/admin/pet-owner-store/orders': {
    get: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'List every order — pet_store.order.manage',
      security: bearer,
      responses: {
        200: ok('Orders', listOf('#/components/schemas/PetStoreOrder')),
        ...errs(401, 403),
      },
    },
  },
  '/admin/pet-owner-store/orders/{orderId}': {
    parameters: [{ name: 'orderId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'One order — pet_store.order.manage',
      security: bearer,
      responses: {
        200: ok('Order', dataOf({ $ref: '#/components/schemas/PetStoreOrder' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/pet-owner-store/orders/{orderId}/status': {
    parameters: [{ name: 'orderId', in: 'path', required: true, schema: uuid }],
    patch: {
      tags: ['Pet Owners Store (Admin)'],
      summary: 'Advance an order status (validated against the transition map)',
      security: bearer,
      responses: {
        200: ok('Order', dataOf({ $ref: '#/components/schemas/PetStoreOrder' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
};

export const petOwnerStoreOpenApi = { tags, paths, schemas };
