import type { ProductStatus, ProductType } from './store.constants.js';

// --- internal aggregate ----------------------------------------------

export interface Product {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  productType: ProductType;
  /** Decimal string (PostgreSQL numeric) or null. Never a JS float. */
  price: string | null;
  stockQuantity: number;
  status: ProductStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API DTO ------------------------------------------------------

export interface ProductDTO {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  productType: ProductType;
  price: string | null;
  stockQuantity: number;
  status: ProductStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- input / filter shapes -------------------------------------

export interface CreateProductInput {
  name: string;
  description?: string | null;
  productType: ProductType;
  price?: string | null;
  /** Opening stock. Optional; defaults to 0. Later changes go through the stock op. */
  stockQuantity?: number;
}

export interface UpdateProductInput {
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
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToProduct(row: ProductRow): Product {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    productType: row.product_type as ProductType,
    price: row.price,
    stockQuantity: Number(row.stock_quantity),
    status: row.status as ProductStatus,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toProductDTO(p: Product): ProductDTO {
  return { ...p };
}
