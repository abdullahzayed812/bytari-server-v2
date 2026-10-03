import type { Knex } from 'knex';
import type {
  ListVeterinarianStoreOrdersFilter,
  VeterinarianStoreOrderItemRow,
  VeterinarianStoreOrderRow,
} from '../domain/veterinarian-store.types.js';

const ORDERS = 'veterinarian_store_orders';
const ITEMS = 'veterinarian_store_order_items';

export interface CreateVeterinarianStoreOrderData {
  orderNumber: string;
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

export interface CreateVeterinarianStoreOrderItemData {
  productId: string | null;
  productNameSnapshot: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export class VeterinarianStoreOrderRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async createOrder(
    data: CreateVeterinarianStoreOrderData,
    items: CreateVeterinarianStoreOrderItemData[],
    trx: Knex.Transaction,
  ): Promise<VeterinarianStoreOrderRow> {
    const [order] = (await trx(ORDERS)
      .insert({
        order_number: data.orderNumber,
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
      .returning('*')) as VeterinarianStoreOrderRow[];
    if (!order) throw new Error('veterinarian store order insert did not return a row');

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

  async findById(id: string, trx?: Knex.Transaction): Promise<VeterinarianStoreOrderRow | null> {
    const row = await this.conn(trx)<VeterinarianStoreOrderRow>(ORDERS).where({ id }).first();
    return row ?? null;
  }

  async listItems(
    orderId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianStoreOrderItemRow[]> {
    return this.conn(trx)<VeterinarianStoreOrderItemRow>(ITEMS)
      .where({ order_id: orderId })
      .orderBy('created_at', 'asc');
  }

  async itemsByOrderIds(orderIds: string[]): Promise<Map<string, VeterinarianStoreOrderItemRow[]>> {
    const map = new Map<string, VeterinarianStoreOrderItemRow[]>();
    if (orderIds.length === 0) return map;
    const rows = await this.db<VeterinarianStoreOrderItemRow>(ITEMS)
      .whereIn('order_id', orderIds)
      .orderBy('created_at', 'asc');
    for (const row of rows) {
      const list = map.get(row.order_id) ?? [];
      list.push(row);
      map.set(row.order_id, list);
    }
    return map;
  }

  async list(
    filter: ListVeterinarianStoreOrdersFilter,
  ): Promise<{ items: VeterinarianStoreOrderRow[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<VeterinarianStoreOrderRow>(ORDERS);
      if (filter.userId) qb.where('user_id', filter.userId);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.newOnly) qb.whereNull('admin_viewed_at');
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const items = await base()
      .orderBy([
        { column: 'placed_at', order: 'desc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items, total };
  }

  /** Orders no store manager has opened yet — the "new orders" badge. */
  async countUnviewed(): Promise<number> {
    const row = await this.db(ORDERS)
      .whereNull('admin_viewed_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  async markViewed(id: string): Promise<void> {
    await this.db(ORDERS).where({ id }).whereNull('admin_viewed_at').update({
      admin_viewed_at: new Date(),
    });
  }

  async setStatus(
    id: string,
    status: string,
    trx: Knex.Transaction,
  ): Promise<VeterinarianStoreOrderRow> {
    const [row] = (await trx(ORDERS)
      .where({ id })
      .update({
        status,
        updated_at: new Date(),
        // acting on an order means a manager has seen it
        admin_viewed_at: trx.raw('COALESCE(admin_viewed_at, now())'),
      })
      .returning('*')) as VeterinarianStoreOrderRow[];
    if (!row) throw new Error('veterinarian store order not found after status change');
    return row;
  }
}
