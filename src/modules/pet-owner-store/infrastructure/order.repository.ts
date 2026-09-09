import type { Knex } from 'knex';
import type {
  ListPetStoreOrdersFilter,
  PetStoreOrderItemRow,
  PetStoreOrderRow,
} from '../domain/pet-owner-store.types.js';

const ORDERS = 'pet_owner_store_orders';
const ITEMS = 'pet_owner_store_order_items';

export interface CreatePetStoreOrderData {
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

export interface CreatePetStoreOrderItemData {
  productId: string | null;
  productNameSnapshot: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export class PetStoreOrderRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async createOrder(
    data: CreatePetStoreOrderData,
    items: CreatePetStoreOrderItemData[],
    trx: Knex.Transaction,
  ): Promise<PetStoreOrderRow> {
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
      .returning('*')) as PetStoreOrderRow[];
    if (!order) throw new Error('pet store order insert did not return a row');

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

  async findById(id: string, trx?: Knex.Transaction): Promise<PetStoreOrderRow | null> {
    const row = await this.conn(trx)<PetStoreOrderRow>(ORDERS).where({ id }).first();
    return row ?? null;
  }

  async listItems(orderId: string, trx?: Knex.Transaction): Promise<PetStoreOrderItemRow[]> {
    return this.conn(trx)<PetStoreOrderItemRow>(ITEMS)
      .where({ order_id: orderId })
      .orderBy('created_at', 'asc');
  }

  async itemsByOrderIds(orderIds: string[]): Promise<Map<string, PetStoreOrderItemRow[]>> {
    const map = new Map<string, PetStoreOrderItemRow[]>();
    if (orderIds.length === 0) return map;
    const rows = await this.db<PetStoreOrderItemRow>(ITEMS)
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
    filter: ListPetStoreOrdersFilter,
  ): Promise<{ items: PetStoreOrderRow[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db<PetStoreOrderRow>(ORDERS);
      if (filter.userId) qb.where('user_id', filter.userId);
      if (filter.status) qb.andWhere('status', filter.status);
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

  async setStatus(id: string, status: string, trx: Knex.Transaction): Promise<PetStoreOrderRow> {
    const [row] = (await trx(ORDERS)
      .where({ id })
      .update({ status, updated_at: new Date() })
      .returning('*')) as PetStoreOrderRow[];
    if (!row) throw new Error('pet store order not found after status change');
    return row;
  }
}
