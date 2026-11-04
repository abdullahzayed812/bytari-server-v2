import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type { VeterinaryOfficeProductService } from '../../veterinary-office/application/veterinary-office-product.service.js';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  ORGANIZATION_STORE_DELIVERY_FEE,
  type OrderActorSide,
  type OrganizationStoreOrderStatus,
} from '../domain/organization-store.constants.js';
import { multiplyMoney, OrganizationStorePolicy } from '../domain/organization-store.policy.js';
import type {
  CheckoutInput,
  ListOrganizationStoreOrdersFilter,
  OrganizationStoreOrderDTO,
  OrganizationStoreOrderItemRow,
  OrganizationStoreOrderRow,
  OrganizationStoreOrdersSummaryDTO,
} from '../domain/organization-store.types.js';
import type { OrganizationStoreCartRepository } from '../infrastructure/organization-store-cart.repository.js';
import type {
  CreateOrganizationStoreOrderItemData,
  OrderParties,
  OrganizationStoreOrderRepository,
} from '../infrastructure/organization-store-order.repository.js';

const LOGO_URL_TTL_SECONDS = 3600;

export interface OrganizationStoreActor {
  actorUserId: string;
  context?: AuditContext;
}

type ViewerSide = 'CUSTOMER' | 'SELLER';

/**
 * Checkout, the customer's order history / tracking, and the seller's incoming
 * orders for Clinic + Veterinary Office stores.
 *
 * - Checkout is one transaction: re-validate every line against the LIVE
 *   product (ACTIVE, visible, priced, same currency), snapshot name + price,
 *   create the order + its first history event, empty the cart.
 * - Every status change appends an `organization_store_order_events` row
 *   (the tracking timeline) under a row lock, audits, and publishes an event
 *   the NotificationPolicy turns into notifications for the customer and the
 *   store's responsible owner / supervisors.
 * - Seller access is organization-scoped: the route already authorized
 *   `store.order.*` in THIS organization, and every lookup here re-checks the
 *   order belongs to it (an id from another store reads as 404).
 */
export class OrganizationStoreOrderService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly orders: OrganizationStoreOrderRepository,
    private readonly carts: OrganizationStoreCartRepository,
    private readonly catalog: VeterinaryOfficeProductService,
    private readonly organizations: OrganizationRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'organization-store-order-service' });
  }

  // --- customer ------------------------------------------------------

  async checkout(
    actor: OrganizationStoreActor,
    organizationId: string,
    input: CheckoutInput,
  ): Promise<OrganizationStoreOrderDTO> {
    OrganizationStorePolicy.assertPaymentMethodEnabled(input.paymentMethod);
    // The store must be selling right now (ACTIVE, store type, not expired,
    // not turned off by the Admin) and taking new orders.
    await this.catalog.assertAcceptingOrders(organizationId);
    const org = await this.organizations.findById(organizationId);
    if (!org) throw new NotFoundError('Store not found');

    const order = await this.db.transaction(async (tx) => {
      const cart = await this.carts.findCartForUpdate(actor.actorUserId, organizationId, tx);
      const lines = cart ? await this.carts.listLines(cart.id, tx) : [];
      OrganizationStorePolicy.assertCartNotEmpty(lines.length);

      const currency = lines[0]?.currency as string;
      const items: CreateOrganizationStoreOrderItemData[] = [];
      for (const line of lines) {
        OrganizationStorePolicy.assertPurchasable(line, organizationId);
        OrganizationStorePolicy.assertSameCurrency(currency, line.currency);
        const price = line.price as string;
        items.push({
          productId: line.productId,
          productNameSnapshot: line.name,
          unitPrice: price,
          quantity: line.quantity,
          lineTotal: multiplyMoney(price, line.quantity),
        });
      }
      const totals = OrganizationStorePolicy.computeTotals(
        items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })),
        ORGANIZATION_STORE_DELIVERY_FEE,
      );

      const created = await this.orders.createOrder(
        {
          orderNumber: OrganizationStorePolicy.generateOrderNumber(org.type),
          organizationId,
          organizationType: org.type,
          userId: actor.actorUserId,
          paymentMethod: input.paymentMethod,
          ...totals,
          currency,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          city: input.city,
          addressLine: input.addressLine,
          note: input.note ?? null,
        },
        items,
        tx,
      );
      await this.orders.addEvent(
        {
          orderId: created.id,
          fromStatus: null,
          toStatus: 'PENDING',
          actorUserId: actor.actorUserId,
          actorSide: 'CUSTOMER',
          note: null,
        },
        tx,
      );
      await this.carts.clear((cart as { id: string }).id, tx);
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_STORE_ORDER_PLACED,
          entityType: AuditEntityType.ORGANIZATION_STORE_ORDER,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: {
            orderId: created.id,
            orderNumber: created.order_number,
            organizationId,
            totalAmount: created.total_amount,
            currency,
            itemCount: items.length,
          },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('organization_store.order.placed', {
      orderId: order.id,
      orderNumber: order.order_number,
      organizationId,
      organizationType: org.type,
      customerUserId: actor.actorUserId,
      actorUserId: actor.actorUserId,
    });
    return this.getMyOrder(actor.actorUserId, order.id);
  }

  async listMyOrders(
    userId: string,
    filter: Omit<ListOrganizationStoreOrdersFilter, 'userId' | 'newOnly'>,
  ): Promise<{ items: OrganizationStoreOrderDTO[]; total: number }> {
    const { items, total } = await this.orders.list({ ...filter, userId });
    return { items: await this.toDTOs(items, 'CUSTOMER'), total };
  }

  async getMyOrder(userId: string, orderId: string): Promise<OrganizationStoreOrderDTO> {
    const order = await this.orders.findById(orderId);
    if (!order || order.user_id !== userId) throw new NotFoundError('Order not found');
    return this.toDetailDTO(order, 'CUSTOMER');
  }

  /**
   * "مراسلة" on the customer's order page: the store organization of an order
   * the caller placed (another shopper's order reads as 404, like `getMyOrder`).
   */
  async customerOrderOrganization(
    userId: string,
    orderId: string,
  ): Promise<{ id: string; type: string; status: string; ownerUserId: string }> {
    const order = await this.orders.findById(orderId);
    if (!order || order.user_id !== userId) throw new NotFoundError('Order not found');
    const org = await this.organizations.findById(order.organization_id);
    if (!org) throw new NotFoundError('Store not found');
    return { id: org.id, type: org.type, status: org.status, ownerUserId: org.ownerUserId };
  }

  async cancelMyOrder(
    actor: OrganizationStoreActor,
    orderId: string,
    note: string | null,
  ): Promise<OrganizationStoreOrderDTO> {
    const updated = await this.changeStatus(actor, 'CUSTOMER', orderId, 'CANCELLED', note, (o) => {
      if (o.user_id !== actor.actorUserId) throw new NotFoundError('Order not found');
      OrganizationStorePolicy.assertCustomerCanCancel(o.status as OrganizationStoreOrderStatus);
    });
    return this.toDetailDTO(updated, 'CUSTOMER');
  }

  // --- seller --------------------------------------------------------

  async listForOrganization(
    organizationId: string,
    filter: Omit<ListOrganizationStoreOrdersFilter, 'organizationId' | 'organizationType'>,
  ): Promise<{ items: OrganizationStoreOrderDTO[]; total: number }> {
    const { items, total } = await this.orders.list({ ...filter, organizationId });
    return { items: await this.toDTOs(items, 'SELLER'), total };
  }

  async summaryForOrganization(organizationId: string): Promise<OrganizationStoreOrdersSummaryDTO> {
    return this.orders.summaryForOrganization(organizationId);
  }

  /** Opening an order as the seller marks it seen (clears the "new" badge). */
  async getForSeller(organizationId: string, orderId: string): Promise<OrganizationStoreOrderDTO> {
    const order = await this.orders.findById(orderId);
    if (!order || order.organization_id !== organizationId) {
      throw new NotFoundError('Order not found');
    }
    await this.orders.markSellerViewed(orderId);
    return this.toDetailDTO(
      { ...order, seller_viewed_at: order.seller_viewed_at ?? new Date() },
      'SELLER',
    );
  }

  /**
   * "مراسلة الزبون" on an incoming order: the customer of an order placed with
   * THIS organization (an order of another store reads as 404).
   */
  async sellerOrderCustomerId(organizationId: string, orderId: string): Promise<string> {
    const order = await this.orders.findById(orderId);
    if (!order || order.organization_id !== organizationId) {
      throw new NotFoundError('Order not found');
    }
    return order.user_id;
  }

  async setStatusAsSeller(
    actor: OrganizationStoreActor,
    organizationId: string,
    orderId: string,
    status: OrganizationStoreOrderStatus,
    note: string | null,
  ): Promise<OrganizationStoreOrderDTO> {
    const updated = await this.changeStatus(actor, 'SELLER', orderId, status, note, (o) => {
      if (o.organization_id !== organizationId) throw new NotFoundError('Order not found');
      OrganizationStorePolicy.assertSellerTransition(
        o.status as OrganizationStoreOrderStatus,
        status,
      );
    });
    return this.toDetailDTO(updated, 'SELLER');
  }

  /** Delivered orders — the office dashboard "مبيعات" stat. */
  async deliveredCount(organizationId: string): Promise<number> {
    return (await this.orders.summaryForOrganization(organizationId)).deliveredCount;
  }

  // --- internals -----------------------------------------------------

  private async changeStatus(
    actor: OrganizationStoreActor,
    side: OrderActorSide,
    orderId: string,
    to: OrganizationStoreOrderStatus,
    note: string | null,
    guard: (order: OrganizationStoreOrderRow) => void,
  ): Promise<OrganizationStoreOrderRow> {
    const { before, after } = await this.db.transaction(async (tx) => {
      const order = await this.orders.findByIdForUpdate(orderId, tx);
      if (!order) throw new NotFoundError('Order not found');
      guard(order);
      const row = await this.orders.setStatus(orderId, to, side, tx);
      await this.orders.addEvent(
        {
          orderId,
          fromStatus: order.status,
          toStatus: to,
          actorUserId: actor.actorUserId,
          actorSide: side,
          note,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ORGANIZATION_STORE_ORDER_STATUS_CHANGED,
          entityType: AuditEntityType.ORGANIZATION_STORE_ORDER,
          entityId: orderId,
          actorUserId: actor.actorUserId,
          metadata: {
            orderId,
            organizationId: order.organization_id,
            from: order.status,
            to,
            side,
          },
          context: actor.context,
        },
        tx,
      );
      return { before: order, after: row };
    });

    this.events.publish('organization_store.order.status_changed', {
      orderId,
      orderNumber: after.order_number,
      organizationId: after.organization_id,
      organizationType: after.organization_type,
      customerUserId: after.user_id,
      fromStatus: before.status,
      status: to,
      actorUserId: actor.actorUserId,
      actorSide: side,
    });
    return after;
  }

  private async toDTOs(
    rows: OrganizationStoreOrderRow[],
    side: ViewerSide,
  ): Promise<OrganizationStoreOrderDTO[]> {
    const [itemsByOrder, parties] = await Promise.all([
      this.orders.itemsByOrderIds(rows.map((r) => r.id)),
      this.orders.parties(rows),
    ]);
    return Promise.all(rows.map((r) => this.toDTO(r, itemsByOrder.get(r.id) ?? [], parties, side)));
  }

  private async toDetailDTO(
    order: OrganizationStoreOrderRow,
    side: ViewerSide,
  ): Promise<OrganizationStoreOrderDTO> {
    const [items, parties, events] = await Promise.all([
      this.orders.listItems(order.id),
      this.orders.parties([order]),
      this.orders.listEvents(order.id),
    ]);
    const dto = await this.toDTO(order, items, parties, side);
    dto.history = events.map((e) => ({
      id: e.id,
      fromStatus: (e.from_status as OrganizationStoreOrderStatus | null) ?? null,
      toStatus: e.to_status as OrganizationStoreOrderStatus,
      actorSide: e.actor_side as OrderActorSide,
      note: e.note,
      createdAt: e.created_at.toISOString(),
    }));
    return dto;
  }

  private async toDTO(
    order: OrganizationStoreOrderRow,
    items: OrganizationStoreOrderItemRow[],
    parties: OrderParties,
    side: ViewerSide,
  ): Promise<OrganizationStoreOrderDTO> {
    const org = parties.organizations.get(order.organization_id);
    const customer = parties.customers.get(order.user_id);
    const status = order.status as OrganizationStoreOrderStatus;
    const lines = items.map((it) => ({
      id: it.id,
      productId: it.product_id,
      name: it.product_name_snapshot,
      unitPrice: it.unit_price,
      quantity: Number(it.quantity),
      lineTotal: it.line_total,
    }));
    return {
      id: order.id,
      orderNumber: order.order_number,
      organization: {
        id: order.organization_id,
        name: org?.name ?? '',
        type: org?.type ?? order.organization_type,
        logoUrl: await resolveStorageUrlOrNull(
          this.storage,
          org?.logoKey ?? null,
          LOGO_URL_TTL_SECONDS,
        ),
      },
      customer: customer
        ? { id: order.user_id, firstName: customer.firstName, lastName: customer.lastName }
        : null,
      status,
      paymentMethod: order.payment_method as OrganizationStoreOrderDTO['paymentMethod'],
      paymentStatus: order.payment_status,
      subtotalAmount: order.subtotal_amount,
      deliveryFee: order.delivery_fee,
      totalAmount: order.total_amount,
      currency: order.currency,
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone,
      city: order.city,
      addressLine: order.address_line,
      note: order.note,
      items: lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      ...(side === 'SELLER'
        ? { isNew: order.seller_viewed_at === null }
        : { canCancel: CUSTOMER_CANCELLABLE_STATUSES.includes(status) }),
      placedAt: order.placed_at.toISOString(),
      updatedAt: order.updated_at.toISOString(),
    };
  }
}
