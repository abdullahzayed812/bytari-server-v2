import type { Knex } from 'knex';
import {
  rowToVeterinarianStoreProduct,
  type ListVeterinarianStoreProductsFilter,
  type VeterinarianStoreProduct,
  type VeterinarianStoreProductImageRow,
  type VeterinarianStoreProductRow,
} from '../domain/veterinarian-store.types.js';

const TABLE = 'veterinarian_store_products';
const IMAGES = 'veterinarian_store_product_images';

export interface CreateVeterinarianStoreProductData {
  categoryId: string | null;
  name: string;
  description: string | null;
  price: string;
  stockQuantity: number;
  attributes: Record<string, string> | null;
  status: string;
  createdByUserId: string;
}

export interface UpdateVeterinarianStoreProductData {
  categoryId?: string | null;
  name?: string;
  description?: string | null;
  price?: string;
  stockQuantity?: number;
  attributes?: Record<string, string> | null;
  status?: string;
  primaryImageKey?: string | null;
}

export interface VeterinarianStoreProductWithCategory {
  product: VeterinarianStoreProduct;
  categoryName: string | null;
}

export class VeterinarianStoreProductRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VeterinarianStoreProduct | null> {
    const row = await this.conn(trx)<VeterinarianStoreProductRow>(TABLE).where({ id }).first();
    return row ? rowToVeterinarianStoreProduct(row) : null;
  }

  async findWithCategory(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianStoreProductWithCategory | null> {
    const row = await this.conn(trx)(`${TABLE} as p`)
      .leftJoin('veterinarian_store_categories as c', 'c.id', 'p.category_id')
      .where('p.id', id)
      .first('p.*', 'c.name as category_name');
    if (!row) return null;
    return { product: rowToVeterinarianStoreProduct(row), categoryName: row.category_name };
  }

  async listImages(productId: string, trx?: Knex.Transaction): Promise<VeterinarianStoreProductImageRow[]> {
    return this.conn(trx)<VeterinarianStoreProductImageRow>(IMAGES)
      .where({ product_id: productId })
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ]);
  }

  async list(
    filter: ListVeterinarianStoreProductsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: VeterinarianStoreProductWithCategory[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as p`).leftJoin(
        'veterinarian_store_categories as c',
        'c.id',
        'p.category_id',
      );
      if (filter.status) qb.where('p.status', filter.status);
      if (filter.categoryId) qb.andWhere('p.category_id', filter.categoryId);
      if (filter.search) {
        qb.andWhereRaw('lower(p.name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: 'p.id' }).first();
    const total = Number(countRow?.count ?? 0);

    const sortColumn =
      filter.sort === 'price' ? 'p.price' : filter.sort === 'name' ? 'p.name' : 'p.created_at';
    const sortOrder = filter.order === 'asc' ? 'asc' : 'desc';

    const rows = (await base()
      .select('p.*', 'c.name as category_name')
      .orderBy([
        { column: sortColumn, order: sortOrder },
        { column: 'p.id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as (VeterinarianStoreProductRow & {
      category_name: string | null;
    })[];

    return {
      items: rows.map((r) => ({
        product: rowToVeterinarianStoreProduct(r),
        categoryName: r.category_name,
      })),
      total,
    };
  }

  async create(data: CreateVeterinarianStoreProductData, trx: Knex.Transaction): Promise<VeterinarianStoreProduct> {
    const [row] = (await trx(TABLE)
      .insert({
        category_id: data.categoryId,
        name: data.name,
        description: data.description,
        price: data.price,
        stock_quantity: data.stockQuantity,
        attributes: data.attributes ? JSON.stringify(data.attributes) : null,
        status: data.status,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as VeterinarianStoreProductRow[];
    if (!row) throw new Error('veterinarian store product insert did not return a row');
    return rowToVeterinarianStoreProduct(row);
  }

  async update(
    id: string,
    patch: UpdateVeterinarianStoreProductData,
    trx: Knex.Transaction,
  ): Promise<VeterinarianStoreProduct> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId;
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.stockQuantity !== undefined) dbPatch.stock_quantity = patch.stockQuantity;
    if (patch.attributes !== undefined) {
      dbPatch.attributes = patch.attributes ? JSON.stringify(patch.attributes) : null;
    }
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.primaryImageKey !== undefined) dbPatch.primary_image_key = patch.primaryImageKey;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as VeterinarianStoreProductRow[];
    if (!row) throw new Error('veterinarian store product not found after update');
    return rowToVeterinarianStoreProduct(row);
  }

  /** Atomic conditional stock decrement — returns the updated row, or null if stock was insufficient. */
  async decrementStock(
    id: string,
    quantity: number,
    trx: Knex.Transaction,
  ): Promise<VeterinarianStoreProduct | null> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .andWhere('stock_quantity', '>=', quantity)
      .update({
        stock_quantity: trx.raw('stock_quantity - ?', [quantity]),
        updated_at: new Date(),
      })
      .returning('*')) as VeterinarianStoreProductRow[];
    return row ? rowToVeterinarianStoreProduct(row) : null;
  }

  async setStock(id: string, quantity: number, trx: Knex.Transaction): Promise<VeterinarianStoreProduct> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ stock_quantity: quantity, updated_at: new Date() })
      .returning('*')) as VeterinarianStoreProductRow[];
    if (!row) throw new Error('veterinarian store product not found after stock change');
    return rowToVeterinarianStoreProduct(row);
  }

  // --- images -------------------------------------------------------

  async addImage(
    productId: string,
    imageKey: string,
    sortOrder: number,
    trx: Knex.Transaction,
  ): Promise<VeterinarianStoreProductImageRow> {
    const [row] = (await trx(IMAGES)
      .insert({ product_id: productId, image_key: imageKey, sort_order: sortOrder })
      .returning('*')) as VeterinarianStoreProductImageRow[];
    if (!row) throw new Error('veterinarian store product image insert did not return a row');
    return row;
  }

  async findImage(
    productId: string,
    imageId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinarianStoreProductImageRow | null> {
    const row = await this.conn(trx)<VeterinarianStoreProductImageRow>(IMAGES)
      .where({ id: imageId, product_id: productId })
      .first();
    return row ?? null;
  }

  async deleteImage(imageId: string, trx: Knex.Transaction): Promise<void> {
    await trx(IMAGES).where({ id: imageId }).delete();
  }

  async nextImageSortOrder(productId: string, trx: Knex.Transaction): Promise<number> {
    const row = await trx(IMAGES)
      .where({ product_id: productId })
      .max<{ max: number | null }>({ max: 'sort_order' })
      .first();
    return (row?.max ?? -1) + 1;
  }
}
