import type { Knex } from 'knex';
import { matchingUserIds, whereTextSearch } from '../../../shared/database/search.js';
import type {
  ListOrganizationStoreOrdersFilter,
  OrganizationStoreOrderEventRow,
  OrganizationStoreOrderItemRow,
  OrganizationStoreOrderRow,
} from '../domain/organization-store.types.js';

const ORDERS = 'organization_store_orders';
const ITEMS = 'organization_store_order_items';
const EVENTS = 'organization_store_order_events';

export interface CreateOrganizationStoreOrderData {
  orderNumber: string;
  organizationId: string;
  organizationType: string;
  userId: string;
  paymentMethod: string;
  subtotalAmount: string;
  deliveryFee: string;
  totalAmount: string;
  currency: string;
  recipientName: string;
  recipientPhone: string;
  city: string;
  addressLine: string;
  note: string | null;
}

export interface CreateOrganizationStoreOrderItemData {
  productId: string | null;
  productNameSnapshot: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderEventData {
  orderId: string;
  fromStatus: string | null;
  toStatus: string;
  actorUserId: string | null;
  actorSide: 'CUSTOMER' | 'SELLER';
  note: string | null;
}

/** Header fields shown on an order card: the store's name / type / logo and the buyer's name. */
export interface OrderParties {
  organizations: Map<string, { name: string; type: string; logoKey: string | null }>;
  customers: Map<string, { firstName: string; lastName: string }>;
}

export class OrganizationStoreOrderRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async createOrder(
    data: CreateOrganizationStoreOrderData,
    items: CreateOrganizationStoreOrderItemData[],
    trx: Knex.Transaction,
  ): Promise<OrganizationStoreOrderRow> {
    const [order] = (await trx(ORDERS)
      .insert({
        order_number: data.orderNumber,
        organization_id: data.organizationId,
        organization_type: data.organizationType,
        user_id: data.userId,
        payment_method: data.paymentMethod,
        subtotal_amount: data.subtotalAmount,
        delivery_fee: data.deliveryFee,
        total_amount: data.totalAmount,
        currency: data.currency,
        recipient_name: data.recipientName,
        recipient_phone: data.recipientPhone,
        city: data.city,
        address_line: data.addressLine,
        note: data.note,
      })
      .returning('*')) as OrganizationStoreOrderRow[];
    if (!order) throw new Error('organization store order insert did not return a row');

    await trx(ITEMS).insert(
      items.map((it) => ({
        order_id: order.id,
        product_id: it.productId,
        product_name_snapshot: it.productNameSnapshot,
        unit_price: it.unitPrice,
        quantity: it.quantity,
        line_total: it.lineTotal,
      })),
    );
    return order;
  }

  async addEvent(data: OrderEventData, trx: Knex.Transaction): Promise<void> {
    await trx(EVENTS).insert({
      order_id: data.orderId,
      from_status: data.fromStatus,
      to_status: data.toStatus,
      actor_user_id: data.actorUserId,
      actor_side: data.actorSide,
      note: data.note,
    });
  }

  async listEvents(orderId: string): Promise<OrganizationStoreOrderEventRow[]> {
    return this.db<OrganizationStoreOrderEventRow>(EVENTS)
      .where({ order_id: orderId })
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<OrganizationStoreOrderRow | null> {
    const row = await this.conn(trx)<OrganizationStoreOrderRow>(ORDERS).where({ id }).first();
    return row ?? null;
  }

  /** Row-lock for a status change, so two concurrent updates never both pass the transition check. */
  async findByIdForUpdate(
    id: string,
    trx: Knex.Transaction,
  ): Promise<OrganizationStoreOrderRow | null> {
    const row = await trx<OrganizationStoreOrderRow>(ORDERS).where({ id }).forUpdate().first();
    return row ?? null;
  }

  async listItems(orderId: string): Promise<OrganizationStoreOrderItemRow[]> {
    return this.db<OrganizationStoreOrderItemRow>(ITEMS)
      .where({ order_id: orderId })
      .orderBy('created_at', 'asc');
  }

  async itemsByOrderIds(orderIds: string[]): Promise<Map<string, OrganizationStoreOrderItemRow[]>> {
    const map = new Map<string, OrganizationStoreOrderItemRow[]>();
    if (orderIds.length === 0) return map;
    const rows = await this.db<OrganizationStoreOrderItemRow>(ITEMS)
      .whereIn('order_id', orderIds)
      .orderBy('created_at', 'asc');
    for (const row of rows) {
      const list = map.get(row.order_id) ?? [];
      list.push(row);
      map.set(row.order_id, list);
    }
    return map;
  }

  async parties(orders: OrganizationStoreOrderRow[]): Promise<OrderParties> {
    const orgIds = [...new Set(orders.map((o) => o.organization_id))];
    const userIds = [...new Set(orders.map((o) => o.user_id))];
    const [orgRows, userRows] = await Promise.all([
      orgIds.length === 0
        ? []
        : this.db('organizations as o')
            .leftJoin('clinic_details as cd', 'cd.organization_id', 'o.id')
            .leftJoin('veterinary_office_details as vd', 'vd.organization_id', 'o.id')
            .whereIn('o.id', orgIds)
            .select(
              'o.id as id',
              'o.name as name',
              'o.type as type',
              this.db.raw('COALESCE(cd.logo_key, vd.logo_key) as logo_key'),
            ),
      userIds.length === 0
        ? []
        : this.db('users').whereIn('id', userIds).select('id', 'first_name', 'last_name'),
    ]);
    return {
      organizations: new Map(
        (orgRows as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          {
            name: r.name as string,
            type: r.type as string,
            logoKey: (r.logo_key as string | null) ?? null,
          },
        ]),
      ),
      customers: new Map(
        (userRows as Array<Record<string, unknown>>).map((r) => [
          r.id as string,
          { firstName: r.first_name as string, lastName: r.last_name as string },
        ]),
      ),
    };
  }

  async list(
    filter: ListOrganizationStoreOrdersFilter,
  ): Promise<{ items: OrganizationStoreOrderRow[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<OrganizationStoreOrderRow>(ORDERS);
      if (filter.userId) void qb.where('user_id', filter.userId);
      if (filter.organizationId) void qb.where('organization_id', filter.organizationId);
      if (filter.organizationType) void qb.where('organization_type', filter.organizationType);
      if (filter.status) void qb.where('status', filter.status);
      if (filter.newOnly) void qb.whereNull('seller_viewed_at');
      if (filter.search) {
        const term = filter.search;
        void qb.where((w) => {
          whereTextSearch(w, term, {
            columns: ['order_number', 'recipient_name', 'recipient_phone', 'city', 'address_line'],
            ids: ['id'],
          });
          void w.orWhereIn('user_id', matchingUserIds(this.db, term));
        });
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const items = await base()
      .orderBy([
        { column: 'placed_at', order: 'desc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items, total: Number(countRow?.count ?? 0) };
  }

  /** The seller dashboard counters for one organization. */
  async summaryForOrganization(organizationId: string): Promise<{
    newCount: number;
    pendingCount: number;
    activeCount: number;
    deliveredCount: number;
    totalCount: number;
  }> {
    const row = (await this.db(ORDERS)
      .where({ organization_id: organizationId })
      .select(
        this.db.raw('COUNT(*) FILTER (WHERE seller_viewed_at IS NULL)::int as new_count'),
        this.db.raw(`COUNT(*) FILTER (WHERE status = 'PENDING')::int as pending_count`),
        this.db.raw(
          `COUNT(*) FILTER (WHERE status IN ('PENDING','CONFIRMED','PROCESSING','SHIPPED'))::int as active_count`,
        ),
        this.db.raw(`COUNT(*) FILTER (WHERE status = 'DELIVERED')::int as delivered_count`),
        this.db.raw('COUNT(*)::int as total_count'),
      )
      .first()) as Record<string, number | string> | undefined;
    return {
      newCount: Number(row?.new_count ?? 0),
      pendingCount: Number(row?.pending_count ?? 0),
      activeCount: Number(row?.active_count ?? 0),
      deliveredCount: Number(row?.delivered_count ?? 0),
      totalCount: Number(row?.total_count ?? 0),
    };
  }

  async markSellerViewed(id: string): Promise<void> {
    await this.db(ORDERS)
      .where({ id })
      .whereNull('seller_viewed_at')
      .update({ seller_viewed_at: new Date() });
  }

  async setStatus(
    id: string,
    status: string,
    side: 'CUSTOMER' | 'SELLER',
    trx: Knex.Transaction,
  ): Promise<OrganizationStoreOrderRow> {
    const patch: Record<string, unknown> = { status, updated_at: new Date() };
    // Acting on an order as the seller means it has been seen.
    if (side === 'SELLER') patch.seller_viewed_at = trx.raw('COALESCE(seller_viewed_at, now())');
    // Cash on Delivery: delivered = paid.
    if (status === 'DELIVERED') patch.payment_status = 'PAID';
    const [row] = (await trx(ORDERS)
      .where({ id })
      .update(patch)
      .returning('*')) as OrganizationStoreOrderRow[];
    if (!row) throw new Error('organization store order not found after status change');
    return row;
  }
}
