import type { Knex } from 'knex';
import {
  rowToVeterinaryStoreProduct,
  type ListVeterinaryStoreProductsFilter,
  type VeterinaryStoreProduct,
  type VeterinaryStoreProductDetailFieldsInput,
  type VeterinaryStoreProductImageRow,
  type VeterinaryStoreProductRow,
} from '../domain/veterinary-store-product.types.js';

const TABLE = 'veterinary_store_products';
const IMAGES = 'veterinary_store_product_images';

export interface CreateVeterinaryStoreProductData extends VeterinaryStoreProductDetailFieldsInput {
  organizationId: string;
  name: string;
  description: string | null;
  productType: string;
  price: string | null;
  stockQuantity: number;
  createdByUserId: string;
}

export interface UpdateVeterinaryStoreProductData extends VeterinaryStoreProductDetailFieldsInput {
  name?: string;
  description?: string | null;
  productType?: string;
  price?: string | null;
  status?: string;
  primaryImageKey?: string | null;
}

/** Product catalog for VETERINARY_STORE organizations only. Never touches Veterinary Office data. */
export class VeterinaryStoreProductRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VeterinaryStoreProduct | null> {
    const row = await this.conn(trx)<VeterinaryStoreProductRow>(TABLE).where({ id }).first();
    return row ? rowToVeterinaryStoreProduct(row) : null;
  }

  /** A product that MUST belong to this store (IDOR guard for `:productId` routes). */
  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinaryStoreProduct | null> {
    const row = await this.conn(trx)<VeterinaryStoreProductRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToVeterinaryStoreProduct(row) : null;
  }

  async create(
    data: CreateVeterinaryStoreProductData,
    trx: Knex.Transaction,
  ): Promise<VeterinaryStoreProduct> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'VETERINARY_STORE',
        name: data.name,
        description: data.description,
        product_type: data.productType,
        price: data.price,
        stock_quantity: data.stockQuantity,
        subtype: data.subtype ?? null,
        weight: data.weight ?? null,
        usage_instructions: data.usageInstructions ?? null,
        dosage: data.dosage ?? null,
        shelf_life: data.shelfLife ?? null,
        manufacturer: data.manufacturer ?? null,
        highlights: data.highlights ?? [],
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as VeterinaryStoreProductRow[];
    if (!row) throw new Error('veterinary store product insert did not return a row');
    return rowToVeterinaryStoreProduct(row);
  }

  async update(
    id: string,
    patch: UpdateVeterinaryStoreProductData,
    trx: Knex.Transaction,
  ): Promise<VeterinaryStoreProduct> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.productType !== undefined) dbPatch.product_type = patch.productType;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.subtype !== undefined) dbPatch.subtype = patch.subtype;
    if (patch.weight !== undefined) dbPatch.weight = patch.weight;
    if (patch.usageInstructions !== undefined) dbPatch.usage_instructions = patch.usageInstructions;
    if (patch.dosage !== undefined) dbPatch.dosage = patch.dosage;
    if (patch.shelfLife !== undefined) dbPatch.shelf_life = patch.shelfLife;
    if (patch.manufacturer !== undefined) dbPatch.manufacturer = patch.manufacturer;
    if (patch.highlights !== undefined) dbPatch.highlights = patch.highlights;
    if (patch.primaryImageKey !== undefined) dbPatch.primary_image_key = patch.primaryImageKey;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as VeterinaryStoreProductRow[];
    if (!row) throw new Error('veterinary store product not found after update');
    return rowToVeterinaryStoreProduct(row);
  }

  /** Set stock to an already-validated absolute value. */
  async setStock(
    id: string,
    quantity: number,
    trx: Knex.Transaction,
  ): Promise<VeterinaryStoreProduct> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ stock_quantity: quantity, updated_at: new Date() })
      .returning('*')) as VeterinaryStoreProductRow[];
    if (!row) throw new Error('veterinary store product not found after stock change');
    return rowToVeterinaryStoreProduct(row);
  }

  async listForOrganization(
    organizationId: string,
    filter: ListVeterinaryStoreProductsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: VeterinaryStoreProduct[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<VeterinaryStoreProductRow>(TABLE).where(
        'organization_id',
        organizationId,
      );
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

    const rows: VeterinaryStoreProductRow[] = await base()
      .orderBy([
        { column: sortColumn, order: sortOrder },
        { column: 'id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToVeterinaryStoreProduct), total };
  }

  // --- images -------------------------------------------------------

  async listImages(
    productId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinaryStoreProductImageRow[]> {
    return this.conn(trx)<VeterinaryStoreProductImageRow>(IMAGES)
      .where({ product_id: productId })
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ]);
  }

  async addImage(
    productId: string,
    imageKey: string,
    sortOrder: number,
    trx: Knex.Transaction,
  ): Promise<VeterinaryStoreProductImageRow> {
    const [row] = (await trx(IMAGES)
      .insert({ product_id: productId, image_key: imageKey, sort_order: sortOrder })
      .returning('*')) as VeterinaryStoreProductImageRow[];
    if (!row) throw new Error('veterinary store product image insert did not return a row');
    return row;
  }

  async findImage(
    productId: string,
    imageId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinaryStoreProductImageRow | null> {
    const row = await this.conn(trx)<VeterinaryStoreProductImageRow>(IMAGES)
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
