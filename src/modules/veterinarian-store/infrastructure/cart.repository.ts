import type { Knex } from 'knex';

const CARTS = 'veterinarian_store_carts';
const ITEMS = 'veterinarian_store_cart_items';

export interface VeterinarianStoreCartRow {
  id: string;
  user_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface VeterinarianStoreCartItemRow {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number | string;
  created_at: Date;
  updated_at: Date;
}

/** A cart item joined with the columns the cart DTO needs from its product. */
export interface CartItemWithProduct {
  id: string;
  productId: string;
  quantity: number;
  name: string;
  price: string;
  currency: string;
  status: string;
  stockQuantity: number;
  primaryImageKey: string | null;
}

export class VeterinarianStoreCartRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findCartByUser(userId: string, trx?: Knex.Transaction): Promise<VeterinarianStoreCartRow | null> {
    const row = await this.conn(trx)<VeterinarianStoreCartRow>(CARTS).where({ user_id: userId }).first();
    return row ?? null;
  }

  async getOrCreateCart(userId: string, trx: Knex.Transaction): Promise<VeterinarianStoreCartRow> {
    const existing = await trx<VeterinarianStoreCartRow>(CARTS).where({ user_id: userId }).first();
    if (existing) return existing;
    const [row] = (await trx(CARTS)
      .insert({ user_id: userId })
      .onConflict('user_id')
      .merge({ updated_at: new Date() })
      .returning('*')) as VeterinarianStoreCartRow[];
    if (!row) throw new Error('veterinarian store cart upsert did not return a row');
    return row;
  }

  async listItemsWithProduct(
    cartId: string,
    trx?: Knex.Transaction,
  ): Promise<CartItemWithProduct[]> {
    const rows = await this.conn(trx)(`${ITEMS} as i`)
      .join('veterinarian_store_products as p', 'p.id', 'i.product_id')
      .where('i.cart_id', cartId)
      .orderBy('i.created_at', 'asc')
      .select(
        'i.id as id',
        'i.product_id as product_id',
        'i.quantity as quantity',
        'p.name as name',
        'p.price as price',
        'p.currency as currency',
        'p.status as status',
        'p.stock_quantity as stock_quantity',
        'p.primary_image_key as primary_image_key',
      );

    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      quantity: Number(r.quantity),
      name: r.name,
      price: r.price,
      currency: r.currency,
      status: r.status,
      stockQuantity: Number(r.stock_quantity),
      primaryImageKey: r.primary_image_key,
    }));
  }

  async findItem(
    cartId: string,
    productId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianStoreCartItemRow | null> {
    const row = await this.conn(trx)<VeterinarianStoreCartItemRow>(ITEMS)
      .where({ cart_id: cartId, product_id: productId })
      .first();
    return row ?? null;
  }

  async findItemById(
    cartId: string,
    itemId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianStoreCartItemRow | null> {
    const row = await this.conn(trx)<VeterinarianStoreCartItemRow>(ITEMS)
      .where({ id: itemId, cart_id: cartId })
      .first();
    return row ?? null;
  }

  async upsertItem(
    cartId: string,
    productId: string,
    quantity: number,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(ITEMS)
      .insert({ cart_id: cartId, product_id: productId, quantity })
      .onConflict(['cart_id', 'product_id'])
      .merge({ quantity, updated_at: new Date() });
    await trx(CARTS).where({ id: cartId }).update({ updated_at: new Date() });
  }

  async setItemQuantity(itemId: string, quantity: number, trx: Knex.Transaction): Promise<void> {
    await trx(ITEMS).where({ id: itemId }).update({ quantity, updated_at: new Date() });
  }

  async deleteItem(itemId: string, trx: Knex.Transaction): Promise<void> {
    await trx(ITEMS).where({ id: itemId }).delete();
  }

  async clear(cartId: string, trx: Knex.Transaction): Promise<void> {
    await trx(ITEMS).where({ cart_id: cartId }).delete();
    await trx(CARTS).where({ id: cartId }).update({ updated_at: new Date() });
  }
}
