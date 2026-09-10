import type { ProductOrgType, ProductStatus, ProductType } from './store.constants.js';

/** Free-text display fields shown on the product-details screen. All optional. */
export interface ProductDetailFields {
  /** Free-text sub-classification within `productType` (e.g. "مضاد حيوي"). */
  subtype: string | null;
  weight: string | null;
  usageInstructions: string | null;
  dosage: string | null;
  shelfLife: string | null;
  manufacturer: string | null;
  /** Short highlight badges shown near the title (e.g. "نتائج سريعة"). */
  highlights: string[];
}

// --- internal aggregate ----------------------------------------------

export interface Product extends ProductDetailFields {
  id: string;
  organizationId: string;
  organizationType: ProductOrgType;
  name: string;
  description: string | null;
  productType: ProductType;
  /** Decimal string (PostgreSQL numeric) or null. Never a JS float. */
  price: string | null;
  stockQuantity: number;
  status: ProductStatus;
  primaryImageKey: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API DTO ------------------------------------------------------

export interface ProductImageDTO {
  id: string;
  url: string;
  sortOrder: number;
}

/**
 * Public/management DTO. `primaryImageUrl` / `images` are resolved
 * server-side from R2 keys — the client never sees a storage key.
 */
export interface ProductDTO extends ProductDetailFields {
  id: string;
  organizationId: string;
  organizationType: ProductOrgType;
  name: string;
  description: string | null;
  productType: ProductType;
  price: string | null;
  stockQuantity: number;
  status: ProductStatus;
  primaryImageUrl: string | null;
  images: ProductImageDTO[];
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- input / filter shapes -------------------------------------

export interface ProductDetailFieldsInput {
  subtype?: string | null;
  weight?: string | null;
  usageInstructions?: string | null;
  dosage?: string | null;
  shelfLife?: string | null;
  manufacturer?: string | null;
  highlights?: string[];
}

export interface CreateProductInput extends ProductDetailFieldsInput {
  name: string;
  description?: string | null;
  productType: ProductType;
  price?: string | null;
  /** Opening stock. Optional; defaults to 0. Later changes go through the stock op. */
  stockQuantity?: number;
}

export interface UpdateProductInput extends ProductDetailFieldsInput {
  name?: string;
  description?: string | null;
  productType?: ProductType;
  price?: string | null;
  status?: ProductStatus;
}

export interface ListProductsFilter {
  page: number;
  pageSize: number;
  status?: ProductStatus;
  productType?: ProductType;
  search?: string;
  sort?: 'name' | 'price' | 'createdAt';
  order?: 'asc' | 'desc';
}

// --- row ---------------------------------------------------------

export interface ProductRow {
  id: string;
  organization_id: string;
  organization_type: string;
  name: string;
  description: string | null;
  product_type: string;
  price: string | null;
  stock_quantity: number | string;
  status: string;
  subtype: string | null;
  weight: string | null;
  usage_instructions: string | null;
  dosage: string | null;
  shelf_life: string | null;
  manufacturer: string | null;
  highlights: string[] | null;
  primary_image_key: string | null;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProductImageRow {
  id: string;
  product_id: string;
  image_key: string;
  sort_order: number;
  created_at: Date;
}

export function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationType: row.organization_type as ProductOrgType,
    name: row.name,
    description: row.description,
    productType: row.product_type as ProductType,
    price: row.price,
    stockQuantity: Number(row.stock_quantity),
    status: row.status as ProductStatus,
    subtype: row.subtype,
    weight: row.weight,
    usageInstructions: row.usage_instructions,
    dosage: row.dosage,
    shelfLife: row.shelf_life,
    manufacturer: row.manufacturer,
    highlights: row.highlights ?? [],
    primaryImageKey: row.primary_image_key,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
