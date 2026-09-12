import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  VETERINARIAN_STORE_CURRENCY,
  VETERINARIAN_STORE_DELIVERY_FEE,
  type VeterinarianStoreOrderStatus,
} from '../domain/veterinarian-store.constants.js';
import { VeterinarianStorePolicy, multiplyMoney } from '../domain/veterinarian-store.policy.js';
import type {
  CheckoutInput,
  ListVeterinarianStoreOrdersFilter,
  VeterinarianStoreOrderDTO,
  VeterinarianStoreOrderItemRow,
  VeterinarianStoreOrderRow,
} from '../domain/veterinarian-store.types.js';
import type { VeterinarianStoreCartRepository } from '../infrastructure/cart.repository.js';
import type {
  CreateVeterinarianStoreOrderItemData,
  VeterinarianStoreOrderRepository,
} from '../infrastructure/order.repository.js';
import type { VeterinarianStoreProductRepository } from '../infrastructure/product.repository.js';

export interface VeterinarianStoreActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Checkout + order history for the signed-in shopper, and the admin order
 * queue. Checkout runs entirely inside one transaction: re-price from live
 * products, decrement stock atomically, snapshot every line, create the order,
 * empty the cart. Only Cash on Delivery is accepted right now.
 */
export class VeterinarianStoreOrderService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly orders: VeterinarianStoreOrderRepository,
    private readonly carts: VeterinarianStoreCartRepository,
    private readonly products: VeterinarianStoreProductRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-store-order-service' });
  }

  // --- checkout ---------------------------------------------------

  async checkout(actor: VeterinarianStoreActor, input: CheckoutInput): Promise<VeterinarianStoreOrderDTO> {
    VeterinarianStorePolicy.assertPaymentMethodEnabled(input.paymentMethod);

    const orderId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.getOrCreateCart(actor.actorUserId, tx);
      const items = await this.carts.listItemsWithProduct(cart.id, tx);
      VeterinarianStorePolicy.assertCartNotEmpty(items.length);

      const lines: CreateVeterinarianStoreOrderItemData[] = [];
      for (const item of items) {
        VeterinarianStorePolicy.assertPurchasable(
          {
            status: item.status,
            stockQuantity: item.stockQuantity,
            name: item.name,
          },
          item.quantity,
        );
        const decremented = await this.products.decrementStock(item.productId, item.quantity, tx);
        if (!decremented) {
          throw new ConflictError(`"${item.name}" does not have enough stock`, {
            code: ErrorCode.INSUFFICIENT_STOCK,
          });
        }
        lines.push({
          productId: item.productId,
          productNameSnapshot: item.name,
          unitPrice: item.price,
          quantity: item.quantity,
          lineTotal: multiplyMoney(item.price, item.quantity),
        });
      }

      const totals = VeterinarianStorePolicy.computeTotals(
        lines.map((l) => ({ unitPrice: l.unitPrice, quantity: l.quantity })),
        VETERINARIAN_STORE_DELIVERY_FEE,
      );

      const order = await this.orders.createOrder(
        {
          orderNumber: VeterinarianStorePolicy.generateOrderNumber(),
          userId: actor.actorUserId,
          paymentMethod: input.paymentMethod,
          subtotalAmount: totals.subtotalAmount,
          deliveryFee: totals.deliveryFee,
          totalAmount: totals.totalAmount,
          currency: VETERINARIAN_STORE_CURRENCY,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          city: input.city,
          addressLine: input.addressLine,
          note: input.note ?? null,
        },
        lines,
        tx,
      );

      await this.carts.clear(cart.id, tx);

      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_ORDER_PLACED,
          entityType: AuditEntityType.VETERINARIAN_STORE_ORDER,
          entityId: order.id,
          actorUserId: actor.actorUserId,
          metadata: {
            orderId: order.id,
            orderNumber: order.order_number,
            totalAmount: order.total_amount,
            itemCount: lines.length,
          },
          context: actor.context,
        },
        tx,
      );

      return order.id;
    });

    this.events.publish('veterinarian_store.order.placed', {
      orderId,
      userId: actor.actorUserId,
    });

    return this.getMyOrder(actor.actorUserId, orderId);
  }

  // --- shopper reads --------------------------------------------

  async listMyOrders(
    userId: string,
    filter: Omit<ListVeterinarianStoreOrdersFilter, 'userId'>,
  ): Promise<{ items: VeterinarianStoreOrderDTO[]; total: number }> {
    const { items, total } = await this.orders.list({ ...filter, userId });
    const itemsByOrder = await this.orders.itemsByOrderIds(items.map((o) => o.id));
    return {
      items: items.map((o) => this.toDTO(o, itemsByOrder.get(o.id) ?? [])),
      total,
    };
  }

  async getMyOrder(userId: string, orderId: string): Promise<VeterinarianStoreOrderDTO> {
    const order = await this.orders.findById(orderId);
    if (!order || order.user_id !== userId) throw new NotFoundError('Order not found');
    return this.toDTO(order, await this.orders.listItems(orderId));
  }

  // --- admin ---------------------------------------------------

  async listAllOrders(
    filter: ListVeterinarianStoreOrdersFilter,
  ): Promise<{ items: VeterinarianStoreOrderDTO[]; total: number }> {
    const { items, total } = await this.orders.list(filter);
    const itemsByOrder = await this.orders.itemsByOrderIds(items.map((o) => o.id));
    return {
      items: items.map((o) => this.toDTO(o, itemsByOrder.get(o.id) ?? [])),
      total,
    };
  }

  async getOrderForAdmin(orderId: string): Promise<VeterinarianStoreOrderDTO> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');
    return this.toDTO(order, await this.orders.listItems(orderId));
  }

  async setOrderStatus(
    actor: VeterinarianStoreActor,
    orderId: string,
    status: VeterinarianStoreOrderStatus,
  ): Promise<VeterinarianStoreOrderDTO> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundError('Order not found');
    VeterinarianStorePolicy.assertOrderTransition(order.status as VeterinarianStoreOrderStatus, status);

    const updated = await this.db.transaction(async (tx) => {
      const row = await this.orders.setStatus(orderId, status, tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_ORDER_STATUS_CHANGED,
          entityType: AuditEntityType.VETERINARIAN_STORE_ORDER,
          entityId: orderId,
          actorUserId: actor.actorUserId,
          metadata: { orderId, from: order.status, to: status },
          context: actor.context,
        },
        tx,
      );
      return row;
    });

    this.events.publish('veterinarian_store.order.status_changed', {
      orderId,
      userId: order.user_id,
      status,
    });

    return this.toDTO(updated, await this.orders.listItems(orderId));
  }

  // --- mapping ------------------------------------------------

  private toDTO(order: VeterinarianStoreOrderRow, items: VeterinarianStoreOrderItemRow[]): VeterinarianStoreOrderDTO {
    return {
      id: order.id,
      orderNumber: order.order_number,
      userId: order.user_id,
      status: order.status as VeterinarianStoreOrderDTO['status'],
      paymentMethod: order.payment_method as VeterinarianStoreOrderDTO['paymentMethod'],
      paymentStatus: order.payment_status as VeterinarianStoreOrderDTO['paymentStatus'],
      subtotalAmount: order.subtotal_amount,
      deliveryFee: order.delivery_fee,
      totalAmount: order.total_amount,
      currency: order.currency,
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      city: order.city,
      addressLine: order.address_line,
      note: order.note,
      items: items.map((it) => ({
        id: it.id,
        productId: it.product_id,
        name: it.product_name_snapshot,
        unitPrice: it.unit_price,
        quantity: Number(it.quantity),
        lineTotal: it.line_total,
      })),
      placedAt: order.placed_at.toISOString(),
      updatedAt: order.updated_at.toISOString(),
    };
  }
}
