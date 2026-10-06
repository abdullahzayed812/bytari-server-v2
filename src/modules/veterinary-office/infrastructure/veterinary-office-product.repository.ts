import type { Knex } from 'knex';
import {
  rowToVeterinaryOfficeProduct,
  type ListVeterinaryOfficeProductsFilter,
  type VeterinaryOfficeProduct,
  type VeterinaryOfficeProductDetailFieldsInput,
  type VeterinaryOfficeProductImageRow,
  type VeterinaryOfficeProductRow,
} from '../domain/veterinary-office-product.types.js';

const TABLE = 'veterinary_office_products';

/** Escape LIKE wildcards in user input (`%`, `_`, `\`). */
/** Free-text columns the office product search looks in (besides `highlights[]`). */
const SEARCH_COLUMNS = [
  'name',
  'brand',
  'country_of_origin',
  'manufacturer',
  'subtype',
  'description',
  'dosage',
  'weight',
  'usage_instructions',
] as const;

/** Lower-cased search words (max 6, de-duplicated). */
function searchTerms(search: string | undefined): string[] {
  if (!search) return [];
  const words = search
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  return [...new Set(words)].slice(0, 6);
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}
const IMAGES = 'veterinary_office_product_images';

export interface CreateVeterinaryOfficeProductData extends VeterinaryOfficeProductDetailFieldsInput {
  organizationId: string;
  name: string;
  description: string | null;
  productType: string;
  price: string | null;
  stockQuantity: number;
  createdByUserId: string;
}

export interface UpdateVeterinaryOfficeProductData extends VeterinaryOfficeProductDetailFieldsInput {
  name?: string;
  description?: string | null;
  productType?: string;
  price?: string | null;
  status?: string;
  isHidden?: boolean;
  primaryImageKey?: string | null;
}

/** Product catalog for VETERINARY_OFFICE organizations only. Never touches Veterinary Store data. */
export class VeterinaryOfficeProductRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VeterinaryOfficeProduct | null> {
    const row = await this.conn(trx)<VeterinaryOfficeProductRow>(TABLE).where({ id }).first();
    return row ? rowToVeterinaryOfficeProduct(row) : null;
  }

  /** A product that MUST belong to this office (IDOR guard for `:productId` routes). */
  async findByIdForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinaryOfficeProduct | null> {
    const row = await this.conn(trx)<VeterinaryOfficeProductRow>(TABLE)
      .where({ id, organization_id: organizationId })
      .first();
    return row ? rowToVeterinaryOfficeProduct(row) : null;
  }

  async create(
    data: CreateVeterinaryOfficeProductData,
    trx: Knex.Transaction,
  ): Promise<VeterinaryOfficeProduct> {
    const [row] = (await trx(TABLE)
      .insert({
        organization_id: data.organizationId,
        organization_type: 'VETERINARY_OFFICE',
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
        brand: data.brand ?? null,
        country_of_origin: data.countryOfOrigin ?? null,
        highlights: data.highlights ?? [],
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as VeterinaryOfficeProductRow[];
    if (!row) throw new Error('veterinary office product insert did not return a row');
    return rowToVeterinaryOfficeProduct(row);
  }

  async update(
    id: string,
    patch: UpdateVeterinaryOfficeProductData,
    trx: Knex.Transaction,
  ): Promise<VeterinaryOfficeProduct> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.productType !== undefined) dbPatch.product_type = patch.productType;
    if (patch.price !== undefined) dbPatch.price = patch.price;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.isHidden !== undefined) dbPatch.is_hidden = patch.isHidden;
    if (patch.subtype !== undefined) dbPatch.subtype = patch.subtype;
    if (patch.weight !== undefined) dbPatch.weight = patch.weight;
    if (patch.usageInstructions !== undefined) dbPatch.usage_instructions = patch.usageInstructions;
    if (patch.dosage !== undefined) dbPatch.dosage = patch.dosage;
    if (patch.shelfLife !== undefined) dbPatch.shelf_life = patch.shelfLife;
    if (patch.manufacturer !== undefined) dbPatch.manufacturer = patch.manufacturer;
    if (patch.brand !== undefined) dbPatch.brand = patch.brand;
    if (patch.countryOfOrigin !== undefined) dbPatch.country_of_origin = patch.countryOfOrigin;
    if (patch.highlights !== undefined) dbPatch.highlights = patch.highlights;
    if (patch.primaryImageKey !== undefined) dbPatch.primary_image_key = patch.primaryImageKey;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as VeterinaryOfficeProductRow[];
    if (!row) throw new Error('veterinary office product not found after update');
    return rowToVeterinaryOfficeProduct(row);
  }

  /** Set stock to an already-validated absolute value. */
  async setStock(
    id: string,
    quantity: number,
    trx: Knex.Transaction,
  ): Promise<VeterinaryOfficeProduct> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ stock_quantity: quantity, updated_at: new Date() })
      .returning('*')) as VeterinaryOfficeProductRow[];
    if (!row) throw new Error('veterinary office product not found after stock change');
    return rowToVeterinaryOfficeProduct(row);
  }

  async listForOrganization(
    organizationId: string,
    filter: ListVeterinaryOfficeProductsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: VeterinaryOfficeProduct[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<VeterinaryOfficeProductRow>(TABLE).where(
        'organization_id',
        organizationId,
      );
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.productType) qb.andWhere('product_type', filter.productType);
      if (filter.hidden !== undefined) qb.andWhere('is_hidden', filter.hidden);
      // Every word must match SOME product attribute (name, brand, country of
      // manufacture, manufacturer, type, description, dosage, weight, usage,
      // highlights) — so «أموكس هندي» finds an Indian amoxicillin.
      for (const term of searchTerms(filter.search)) {
        const like = `%${escapeLike(term)}%`;
        qb.andWhere((w) => {
          for (const col of SEARCH_COLUMNS) {
            void w.orWhereRaw(`lower(coalesce(${col}, '')) like ? escape '\\'`, [like]);
          }
          void w.orWhereRaw("lower(array_to_string(highlights, ' ')) like ? escape '\\'", [like]);
        });
      }
      if (filter.brand) qb.andWhereRaw('lower(brand) = ?', [filter.brand.toLowerCase()]);
      if (filter.country) {
        qb.andWhereRaw('lower(country_of_origin) = ?', [filter.country.toLowerCase()]);
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const sortColumn =
      filter.sort === 'price' ? 'price' : filter.sort === 'name' ? 'name' : 'created_at';
    const sortOrder = filter.order === 'asc' ? 'asc' : 'desc';

    // Search without an explicit sort ranks name matches first (prefix, then
    // contains), then everything else by the default newest-first order.
    const phrase = filter.search ? filter.search.trim().toLowerCase() : null;
    const rows: VeterinaryOfficeProductRow[] = await base()
      .modify((qb) => {
        if (phrase && !filter.sort) {
          qb.orderByRaw(
            "CASE WHEN lower(name) LIKE ? escape '\\' THEN 0 WHEN lower(name) LIKE ? escape '\\' THEN 1 ELSE 2 END",
            [`${escapeLike(phrase)}%`, `%${escapeLike(phrase)}%`],
          );
        }
      })
      .orderBy([
        { column: sortColumn, order: sortOrder },
        { column: 'id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToVeterinaryOfficeProduct), total };
  }

  /**
   * Distinct brands / countries among an office's ACTIVE, visible products —
   * the catalog's filter chips. Bounded to 100 values each.
   */
  async facetsForOrganization(
    organizationId: string,
  ): Promise<{ brands: string[]; countries: string[] }> {
    const distinct = async (column: 'brand' | 'country_of_origin'): Promise<string[]> => {
      const rows = (await this.db(TABLE)
        .where({ organization_id: organizationId, status: 'ACTIVE', is_hidden: false })
        .whereNotNull(column)
        .select(this.db.raw(`min(${column}) as value`))
        .groupByRaw(`lower(${column})`)
        .orderByRaw(`lower(${column})`)
        .limit(100)) as { value: string }[];
      return rows.map((r) => r.value);
    };
    const [brands, countries] = await Promise.all([
      distinct('brand'),
      distinct('country_of_origin'),
    ]);
    return { brands, countries };
  }

  /** Live, visible product count — the Dashboard home's "المنتجات" stat. */
  async countVisibleForOrganization(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const row = await this.conn(trx)(TABLE)
      .where({ organization_id: organizationId, status: 'ACTIVE', is_hidden: false })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  // --- images -------------------------------------------------------

  async listImages(
    productId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinaryOfficeProductImageRow[]> {
    return this.conn(trx)<VeterinaryOfficeProductImageRow>(IMAGES)
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
  ): Promise<VeterinaryOfficeProductImageRow> {
    const [row] = (await trx(IMAGES)
      .insert({ product_id: productId, image_key: imageKey, sort_order: sortOrder })
      .returning('*')) as VeterinaryOfficeProductImageRow[];
    if (!row) throw new Error('veterinary office product image insert did not return a row');
    return row;
  }

  async findImage(
    productId: string,
    imageId: string,
    trx?: Knex.Transaction,
  ): Promise<VeterinaryOfficeProductImageRow | null> {
    const row = await this.conn(trx)<VeterinaryOfficeProductImageRow>(IMAGES)
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
