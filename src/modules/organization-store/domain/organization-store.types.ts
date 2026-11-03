import type {
  OrderActorSide,
  OrganizationStoreOrderStatus,
  OrganizationStorePaymentMethod,
} from './organization-store.constants.js';

// --- rows -----------------------------------------------------------

export interface OrganizationStoreOrderRow {
  id: string;
  order_number: string;
  organization_id: string;
  organization_type: string;
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
  seller_viewed_at: Date | null;
  placed_at: Date;
  updated_at: Date;
}

export interface OrganizationStoreOrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  unit_price: string;
  quantity: number | string;
  line_total: string;
  created_at: Date;
}

export interface OrganizationStoreOrderEventRow {
  id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string | null;
  actor_side: string;
  note: string | null;
  created_at: Date;
}

// --- DTOs -----------------------------------------------------------

export interface OrganizationStoreCartItemDTO {
  id: string;
  productId: string;
  name: string;
  primaryImageUrl: string | null;
  /** Live product price (decimal string), `null` when the product lost its price. */
  unitPrice: string | null;
  currency: string;
  quantity: number;
  lineTotal: string | null;
  /** ACTIVE, visible and priced right now — checkout rejects the cart otherwise. */
  available: boolean;
}

export interface OrganizationStoreCartDTO {
  id: string | null;
  organizationId: string;
  items: OrganizationStoreCartItemDTO[];
  itemCount: number;
  /** Totals over the AVAILABLE lines only. */
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  /** The cart's single currency, `null` while empty. */
  currency: string | null;
}

/** Light per-store cart entry for "my carts" (header badges / cart list). */
export interface OrganizationStoreCartSummaryDTO {
  organizationId: string;
  organizationName: string;
  organizationType: string;
  itemCount: number;
}

export interface OrganizationStoreOrderItemDTO {
  id: string;
  productId: string | null;
  name: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrganizationStoreOrderEventDTO {
  id: string;
  fromStatus: OrganizationStoreOrderStatus | null;
  toStatus: OrganizationStoreOrderStatus;
  actorSide: OrderActorSide;
  note: string | null;
  createdAt: string;
}

export interface OrganizationStoreOrderDTO {
  id: string;
  orderNumber: string;
  organization: { id: string; name: string; type: string; logoUrl: string | null };
  customer: { id: string; firstName: string; lastName: string } | null;
  status: OrganizationStoreOrderStatus;
  paymentMethod: OrganizationStorePaymentMethod;
  paymentStatus: string;
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  currency: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note: string | null;
  items: OrganizationStoreOrderItemDTO[];
  itemCount: number;
  /** Seller view only: no seller-side member has opened it yet. */
  isNew?: boolean;
  /** Customer view only: may the caller still cancel it? */
  canCancel?: boolean;
  /** Detail views only — the tracking timeline, oldest first. */
  history?: OrganizationStoreOrderEventDTO[];
  placedAt: string;
  updatedAt: string;
}

export interface OrganizationStoreOrdersSummaryDTO {
  newCount: number;
  pendingCount: number;
  activeCount: number;
  deliveredCount: number;
  totalCount: number;
}

// --- inputs ---------------------------------------------------------

export interface CheckoutInput {
  paymentMethod: OrganizationStorePaymentMethod;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note?: string | null;
}

export interface ListOrganizationStoreOrdersFilter {
  page: number;
  pageSize: number;
  status?: OrganizationStoreOrderStatus;
  userId?: string;
  organizationId?: string;
  organizationType?: string;
  newOnly?: boolean;
  search?: string;
}
