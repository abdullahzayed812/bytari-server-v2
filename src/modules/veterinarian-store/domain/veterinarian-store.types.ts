import type {
  VeterinarianStoreCategoryStatus,
  VeterinarianStoreOrderStatus,
  VeterinarianStorePaymentMethod,
  VeterinarianStorePaymentStatus,
  VeterinarianStoreProductSort,
  VeterinarianStoreProductStatus,
} from './veterinarian-store.constants.js';

// =====================================================================
// Category
// =====================================================================

export interface VeterinarianStoreCategory {
  id: string;
  slug: string;
  name: string;
  imageKey: string | null;
  showOnHome: boolean;
  sortOrder: number;
  status: VeterinarianStoreCategoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VeterinarianStoreCategoryDTO {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  showOnHome: boolean;
  sortOrder: number;
  status: VeterinarianStoreCategoryStatus;
  productCount?: number;
}

export interface VeterinarianStoreCategoryRow {
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

export function rowToVeterinarianStoreCategory(row: VeterinarianStoreCategoryRow): VeterinarianStoreCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    imageKey: row.image_key,
    showOnHome: row.show_on_home,
    sortOrder: row.sort_order,
    status: row.status as VeterinarianStoreCategoryStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// =====================================================================
// Product
// =====================================================================

export interface VeterinarianStoreProductImage {
  id: string;
  imageKey: string;
  sortOrder: number;
}

export interface VeterinarianStoreProduct {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  /** Decimal string (PostgreSQL `numeric(12,2)`). Never a JS float. */
  price: string;
  currency: string;
  stockQuantity: number;
  status: VeterinarianStoreProductStatus;
  primaryImageKey: string | null;
  attributes: Record<string, string> | null;
  ratingAverage: string | null;
  ratingCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Consumer list-card projection. */
export interface VeterinarianStoreProductListItemDTO {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  price: string;
  currency: string;
  inStock: boolean;
  status: VeterinarianStoreProductStatus;
  primaryImageUrl: string | null;
  ratingAverage: string | null;
  ratingCount: number;
}

/** Consumer detail projection (adds description / gallery / attributes / stock). */
export interface VeterinarianStoreProductDetailDTO extends VeterinarianStoreProductListItemDTO {
  description: string | null;
  stockQuantity: number;
  attributes: Record<string, string> | null;
  images: { id: string; url: string; sortOrder: number }[];
}

/** Admin projection — raw keys + audit fields, no signed URLs stripped. */
export interface VeterinarianStoreAdminProductDTO {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  stockQuantity: number;
  status: VeterinarianStoreProductStatus;
  primaryImageUrl: string | null;
  attributes: Record<string, string> | null;
  images: { id: string; url: string; sortOrder: number }[];
  ratingAverage: string | null;
  ratingCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VeterinarianStoreProductRow {
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

export function rowToVeterinarianStoreProduct(row: VeterinarianStoreProductRow): VeterinarianStoreProduct {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    stockQuantity: Number(row.stock_quantity),
    status: row.status as VeterinarianStoreProductStatus,
    primaryImageKey: row.primary_image_key,
    attributes: row.attributes,
    ratingAverage: row.rating_average,
    ratingCount: Number(row.rating_count),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface VeterinarianStoreProductImageRow {
  id: string;
  product_id: string;
  image_key: string;
  sort_order: number;
  created_at: Date;
}

// =====================================================================
// Cart
// =====================================================================

export interface VeterinarianStoreCartItemDTO {
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

export interface VeterinarianStoreCartDTO {
  id: string;
  items: VeterinarianStoreCartItemDTO[];
  itemCount: number;
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  currency: string;
}

// =====================================================================
// Order
// =====================================================================

export interface VeterinarianStoreOrderItemDTO {
  id: string;
  productId: string | null;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface VeterinarianStoreOrderDTO {
  id: string;
  orderNumber: string;
  userId: string;
  status: VeterinarianStoreOrderStatus;
  paymentMethod: VeterinarianStorePaymentMethod;
  paymentStatus: VeterinarianStorePaymentStatus;
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  currency: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note: string | null;
  items: VeterinarianStoreOrderItemDTO[];
  placedAt: string;
  updatedAt: string;
}

export interface VeterinarianStoreOrderRow {
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

export interface VeterinarianStoreOrderItemRow {
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

export interface ListVeterinarianStoreProductsFilter {
  page: number;
  pageSize: number;
  categoryId?: string;
  search?: string;
  sort?: VeterinarianStoreProductSort;
  order?: 'asc' | 'desc';
  /** Admin-only — consumer listing is always ACTIVE. */
  status?: VeterinarianStoreProductStatus;
}

export interface CreateVeterinarianStoreProductInput {
  categoryId?: string | null;
  name: string;
  description?: string | null;
  price: string;
  stockQuantity?: number;
  attributes?: Record<string, string> | null;
  status?: VeterinarianStoreProductStatus;
}

export interface UpdateVeterinarianStoreProductInput {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
  price?: string;
  stockQuantity?: number;
  attributes?: Record<string, string> | null;
  status?: VeterinarianStoreProductStatus;
}

export interface CreateVeterinarianStoreCategoryInput {
  slug: string;
  name: string;
  showOnHome?: boolean;
  sortOrder?: number;
  status?: VeterinarianStoreCategoryStatus;
}

export interface UpdateVeterinarianStoreCategoryInput {
  slug?: string;
  name?: string;
  showOnHome?: boolean;
  sortOrder?: number;
  status?: VeterinarianStoreCategoryStatus;
}

export interface CheckoutInput {
  paymentMethod: VeterinarianStorePaymentMethod;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note?: string | null;
}

export interface ListVeterinarianStoreOrdersFilter {
  page: number;
  pageSize: number;
  status?: VeterinarianStoreOrderStatus;
  /** Admin-only — consumer listing is always the caller's own orders. */
  userId?: string;
}
