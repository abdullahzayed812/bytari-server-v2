import type { Knex } from 'knex';
import {
  rowToProduct,
  type ListProductsFilter,
  type Product,
  type ProductRow,
} from '../domain/store.types.js';

const TABLE = 'products';

export interface CreateProductData {
  organizationId: string;
  name: string;
  description: string | null;
  productType: string;
  price: string | null;
  stockQuantity: number;
  createdByUserId: string;
}

export interface UpdateProductData {
  name?: string;
  description?: string | null;
  productType?: string;
  price?: string | null;
  status?: string;
}

export class ProductRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Product | null> {
    const row = await this.conn(trx)<ProductRow>(TABLE).where({ id }).first();
    return row ? rowToProduct(row) : null;
  }

  /** A product that MUST belong to this store (IDOR guard for `:productId` routes). */
  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<Product | null> {
    const row = await this.conn(trx)<ProductRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToProduct(row) : null;
  }

  async create(data: CreateProductData, trx: Knex.Transaction): Promise<Product> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'VETERINARY_STORE',
        name: data.name,
        description: data.description,
        product_type: data.productType,
        price: data.price,
        stock_quantity: data.stockQuantity,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as ProductRow[];
    if (!row) throw new Error('product insert did not return a row');
    return rowToProduct(row);
  }

  async update(id: string, patch: UpdateProductData, trx: Knex.Transaction): Promise<Product> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.productType !== undefined) dbPatch.product_type = patch.productType;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.status !== undefined) dbPatch.status = patch.status;

    const [row] = (await trx(TABLE).where({ id }).update(dbPatch).returning('*')) as ProductRow[];
    if (!row) throw new Error('product not found after update');
    return rowToProduct(row);
  }

  /** Set stock to an already-validated absolute value. */
  async setStock(id: string, quantity: number, trx: Knex.Transaction): Promise<Product> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ stock_quantity: quantity, updated_at: new Date() })
      .returning('*')) as ProductRow[];
    if (!row) throw new Error('product not found after stock change');
    return rowToProduct(row);
  }

  async listForOrganization(
    organizationId: string,
    filter: ListProductsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: Product[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<ProductRow>(TABLE).where('organization_id', organizationId);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.productType) qb.andWhere('product_type', filter.productType);
      if (filter.search) {
        qb.andWhereRaw('lower(name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const sortColumn =
      filter.sort === 'price' ? 'price' : filter.sort === 'name' ? 'name' : 'created_at';
    const sortOrder = filter.order === 'asc' ? 'asc' : 'desc';

    const rows: ProductRow[] = await base()
      .orderBy([
        { column: sortColumn, order: sortOrder },
        { column: 'id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToProduct), total };
  }
}
