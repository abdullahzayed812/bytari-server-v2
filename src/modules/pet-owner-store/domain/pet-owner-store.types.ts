import type {
  PetStoreCategoryStatus,
  PetStoreOrderStatus,
  PetStorePaymentMethod,
  PetStorePaymentStatus,
  PetStoreProductSort,
  PetStoreProductStatus,
} from './pet-owner-store.constants.js';

// =====================================================================
// Category
// =====================================================================

export interface PetStoreCategory {
  id: string;
  slug: string;
  name: string;
  imageKey: string | null;
  showOnHome: boolean;
  sortOrder: number;
  status: PetStoreCategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PetStoreCategoryDTO {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  showOnHome: boolean;
  sortOrder: number;
  status: PetStoreCategoryStatus;
  productCount?: number;
}

export interface PetStoreCategoryRow {
  id: string;
  slug: string;
  name: string;
  image_key: string | null;
  show_on_home: boolean;
  sort_order: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export function rowToPetStoreCategory(row: PetStoreCategoryRow): PetStoreCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageKey: row.image_key,
    showOnHome: row.show_on_home,
    sortOrder: row.sort_order,
    status: row.status as PetStoreCategoryStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// =====================================================================
// Product
// =====================================================================

export interface PetStoreProductImage {
  id: string;
  imageKey: string;
  sortOrder: number;
}

export interface PetStoreProduct {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  /** Decimal string (PostgreSQL `numeric(12,2)`). Never a JS float. */
  price: string;
  currency: string;
  stockQuantity: number;
  status: PetStoreProductStatus;
  primaryImageKey: string | null;
  attributes: Record<string, string> | null;
  ratingAverage: string | null;
  ratingCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Consumer list-card projection. */
export interface PetStoreProductListItemDTO {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  price: string;
  currency: string;
  inStock: boolean;
  status: PetStoreProductStatus;
  primaryImageUrl: string | null;
  ratingAverage: string | null;
  ratingCount: number;
}

/** Consumer detail projection (adds description / gallery / attributes / stock). */
export interface PetStoreProductDetailDTO extends PetStoreProductListItemDTO {
  description: string | null;
  stockQuantity: number;
  attributes: Record<string, string> | null;
  images: { id: string; url: string; sortOrder: number }[];
}

/** Admin projection — raw keys + audit fields, no signed URLs stripped. */
export interface PetStoreAdminProductDTO {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  stockQuantity: number;
  status: PetStoreProductStatus;
  primaryImageUrl: string | null;
  attributes: Record<string, string> | null;
  images: { id: string; url: string; sortOrder: number }[];
  ratingAverage: string | null;
  ratingCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PetStoreProductRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  stock_quantity: number | string;
  status: string;
  primary_image_key: string | null;
  attributes: Record<string, string> | null;
  rating_average: string | null;
  rating_count: number | string;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToPetStoreProduct(row: PetStoreProductRow): PetStoreProduct {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    stockQuantity: Number(row.stock_quantity),
    status: row.status as PetStoreProductStatus,
    primaryImageKey: row.primary_image_key,
    attributes: row.attributes,
    ratingAverage: row.rating_average,
    ratingCount: Number(row.rating_count),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface PetStoreProductImageRow {
  id: string;
  product_id: string;
  image_key: string;
  sort_order: number;
  created_at: Date;
}

// =====================================================================
// Cart
// =====================================================================

export interface PetStoreCartItemDTO {
  id: string;
  productId: string;
  name: string;
  primaryImageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  inStock: boolean;
  availableStock: number;
}

export interface PetStoreCartDTO {
  id: string;
  items: PetStoreCartItemDTO[];
  itemCount: number;
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  currency: string;
}

// =====================================================================
// Order
// =====================================================================

export interface PetStoreOrderItemDTO {
  id: string;
  productId: string | null;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface PetStoreOrderDTO {
  id: string;
  orderNumber: string;
  userId: string;
  status: PetStoreOrderStatus;
  paymentMethod: PetStorePaymentMethod;
  paymentStatus: PetStorePaymentStatus;
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  currency: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note: string | null;
  items: PetStoreOrderItemDTO[];
  placedAt: string;
  updatedAt: string;
}

export interface PetStoreOrderRow {
  id: string;
  order_number: string;
  user_id: string;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal_amount: string;
  delivery_fee: string;
  total_amount: string;
  currency: string;
  recipient_name: string;
  recipient_phone: string;
  city: string;
  address_line: string;
  note: string | null;
  placed_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PetStoreOrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  unit_price: string;
  quantity: number | string;
  line_total: string;
  created_at: Date;
}

// =====================================================================
// Inputs / filters
// =====================================================================

export interface ListPetStoreProductsFilter {
  page: number;
  pageSize: number;
  categoryId?: string;
  search?: string;
  sort?: PetStoreProductSort;
  order?: 'asc' | 'desc';
  /** Admin-only — consumer listing is always ACTIVE. */
  status?: PetStoreProductStatus;
}

export interface CreatePetStoreProductInput {
  categoryId?: string | null;
  name: string;
  description?: string | null;
  price: string;
  stockQuantity?: number;
  attributes?: Record<string, string> | null;
  status?: PetStoreProductStatus;
}

export interface UpdatePetStoreProductInput {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
  price?: string;
  stockQuantity?: number;
  attributes?: Record<string, string> | null;
  status?: PetStoreProductStatus;
}

export interface CreatePetStoreCategoryInput {
  slug: string;
  name: string;
  showOnHome?: boolean;
  sortOrder?: number;
  status?: PetStoreCategoryStatus;
}

export interface UpdatePetStoreCategoryInput {
  slug?: string;
  name?: string;
  showOnHome?: boolean;
  sortOrder?: number;
  status?: PetStoreCategoryStatus;
}

export interface CheckoutInput {
  paymentMethod: PetStorePaymentMethod;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note?: string | null;
}

export interface ListPetStoreOrdersFilter {
  page: number;
  pageSize: number;
  status?: PetStoreOrderStatus;
  /** Admin-only — consumer listing is always the caller's own orders. */
  userId?: string;
}
