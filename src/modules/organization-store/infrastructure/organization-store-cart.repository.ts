import type { Knex } from 'knex';

const CARTS = 'organization_store_carts';
const ITEMS = 'organization_store_cart_items';
const PRODUCTS = 'veterinary_office_products';

export interface OrganizationStoreCartRow {
  id: string;
  user_id: string;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationStoreCartItemRow {
  id: string;
  cart_id: string;
  product_id: string;
  quantity: number | string;
}

/** A cart line joined with the product columns the cart / checkout need. */
export interface CartLineWithProduct {
  id: string;
  productId: string;
  quantity: number;
  organizationId: string;
  name: string;
  price: string | null;
  currency: string;
  status: string;
  isHidden: boolean;
  primaryImageKey: string | null;
}

/** One cart per (shopper, organization). Every query is scoped to both ids. */
export class OrganizationStoreCartRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findCart(
    userId: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationStoreCartRow | null> {
    const row = await this.conn(trx)<OrganizationStoreCartRow>(CARTS)
      .where({ user_id: userId, organization_id: organizationId })
      .first();
    return row ?? null;
  }

  /** Row-lock the cart for checkout, so a double-submit cannot turn one cart into two orders. */
  async findCartForUpdate(
    userId: string,
    organizationId: string,
    trx: Knex.Transaction,
  ): Promise<OrganizationStoreCartRow | null> {
    const row = await trx<OrganizationStoreCartRow>(CARTS)
      .where({ user_id: userId, organization_id: organizationId })
      .forUpdate()
      .first();
    return row ?? null;
  }

  async getOrCreateCart(
    userId: string,
    organizationId: string,
    trx: Knex.Transaction,
  ): Promise<OrganizationStoreCartRow> {
    const existing = await this.findCart(userId, organizationId, trx);
    if (existing) return existing;
    const [row] = (await trx(CARTS)
      .insert({ user_id: userId, organization_id: organizationId })
      .onConflict(['user_id', 'organization_id'])
      .merge({ updated_at: new Date() })
      .returning('*')) as OrganizationStoreCartRow[];
    if (!row) throw new Error('organization store cart upsert did not return a row');
    return row;
  }

  async listLines(cartId: string, trx?: Knex.Transaction): Promise<CartLineWithProduct[]> {
    const rows = await this.conn(trx)(`${ITEMS} as i`)
      .join(`${PRODUCTS} as p`, 'p.id', 'i.product_id')
      .where('i.cart_id', cartId)
      .orderBy([
        { column: 'i.created_at', order: 'asc' },
        { column: 'i.id', order: 'asc' },
      ])
      .select(
        'i.id as id',
        'i.product_id as product_id',
        'i.quantity as quantity',
        'p.organization_id as organization_id',
        'p.name as name',
        'p.price as price',
        'p.currency as currency',
        'p.status as status',
        'p.is_hidden as is_hidden',
        'p.primary_image_key as primary_image_key',
      );
    return rows.map((r) => ({
      id: r.id as string,
      productId: r.product_id as string,
      quantity: Number(r.quantity),
      organizationId: r.organization_id as string,
      name: r.name as string,
      price: (r.price as string | null) ?? null,
      currency: r.currency as string,
      status: r.status as string,
      isHidden: Boolean(r.is_hidden),
      primaryImageKey: (r.primary_image_key as string | null) ?? null,
    }));
  }

  async findItem(
    cartId: string,
    productId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationStoreCartItemRow | null> {
    const row = await this.conn(trx)<OrganizationStoreCartItemRow>(ITEMS)
      .where({ cart_id: cartId, product_id: productId })
      .first();
    return row ?? null;
  }

  async findItemById(
    cartId: string,
    itemId: string,
    trx?: Knex.Transaction,
  ): Promise<OrganizationStoreCartItemRow | null> {
    const row = await this.conn(trx)<OrganizationStoreCartItemRow>(ITEMS)
      .where({ id: itemId, cart_id: cartId })
      .first();
    return row ?? null;
  }

  async countLines(cartId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(ITEMS)
      .where({ cart_id: cartId })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
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

  /** The shopper's non-empty carts across every store, newest first. */
  async listNonEmptyForUser(userId: string): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      organizationType: string;
      itemCount: number;
    }>
  > {
    const rows = await this.db(`${CARTS} as c`)
      .join(`${ITEMS} as i`, 'i.cart_id', 'c.id')
      .join('organizations as o', 'o.id', 'c.organization_id')
      .leftJoin('clinic_details as cd', 'cd.organization_id', 'o.id')
      .where('c.user_id', userId)
      // A clinic store the Admin turned off is hidden (the cart itself is kept).
      .where((w) => {
        void w.whereNull('cd.store_enabled').orWhere('cd.store_enabled', true);
      })
      .groupBy('c.organization_id', 'o.name', 'o.type', 'c.updated_at')
      .orderBy('c.updated_at', 'desc')
      .select(
        'c.organization_id as organization_id',
        'o.name as name',
        'o.type as type',
        this.db.raw('SUM(i.quantity)::int as item_count'),
      );
    return rows.map((r: Record<string, unknown>) => ({
      organizationId: r.organization_id as string,
      organizationName: r.name as string,
      organizationType: r.type as string,
      itemCount: Number(r.item_count),
    }));
  }
}
