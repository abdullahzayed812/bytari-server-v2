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

/** One hit of {@link VeterinaryOfficeProductRepository.searchAcrossOffices}. */
export interface OfficeProductSearchRow {
  product: VeterinaryOfficeProduct;
  office: {
    id: string;
    name: string;
    logoKey: string | null;
    address: string | null;
    phone: string | null;
  };
}

export interface CreateVeterinaryOfficeProductData extends VeterinaryOfficeProductDetailFieldsInput {
  organizationId: string;
  name: string;
  description: string | null;
  productType: string;
  price: string | null;
  currency: string;
  stockQuantity: number;
  createdByUserId: string;
}

export interface UpdateVeterinaryOfficeProductData extends VeterinaryOfficeProductDetailFieldsInput {
  name?: string;
  description?: string | null;
  productType?: string;
  price?: string | null;
  currency?: string;
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
        currency: data.currency,
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
    if (patch.currency !== undefined) dbPatch.currency = patch.currency;
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
   * Product search across EVERY publicly browsable Veterinary Office — the
   * same visibility rule as one office's public catalog (ACTIVE office of type
   * VETERINARY_OFFICE, subscription not expired; ACTIVE, non-hidden product)
   * and the same word matching as {@link listForOrganization}. Each row
   * carries its office's public identity (id, name, logo key, address, phone).
   */
  async searchAcrossOffices(filter: {
    page: number;
    pageSize: number;
    search?: string;
    productType?: string;
    brand?: string;
    country?: string;
    sort?: 'name' | 'price' | 'createdAt';
    order?: 'asc' | 'desc';
  }): Promise<{ items: OfficeProductSearchRow[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db(`${TABLE} as p`)
        .join('organizations as o', 'o.id', 'p.organization_id')
        .leftJoin('veterinary_office_details as d', 'd.organization_id', 'o.id')
        .where('o.type', 'VETERINARY_OFFICE')
        .where('o.status', 'ACTIVE')
        .where((w) => {
          // An EXPIRED office is off the public market until renewed.
          void w
            .whereNull('d.subscription_end_date')
            .orWhereRaw('d.subscription_end_date >= CURRENT_DATE');
        })
        .where('p.status', 'ACTIVE')
        .where('p.is_hidden', false);
      if (filter.productType) qb.andWhere('p.product_type', filter.productType);
      if (filter.brand) qb.andWhereRaw('lower(p.brand) = ?', [filter.brand.toLowerCase()]);
      if (filter.country) {
        qb.andWhereRaw('lower(p.country_of_origin) = ?', [filter.country.toLowerCase()]);
      }
      for (const term of searchTerms(filter.search)) {
        const like = `%${escapeLike(term)}%`;
        qb.andWhere((w) => {
          for (const col of SEARCH_COLUMNS) {
            void w.orWhereRaw(`lower(coalesce(p.${col}, '')) like ? escape '\\'`, [like]);
          }
          void w.orWhereRaw("lower(array_to_string(p.highlights, ' ')) like ? escape '\\'", [like]);
        });
      }
      return qb;
    };

    const countRow = (await base().count<{ count: string }>({ count: '*' }).first()) as
      { count?: string } | undefined;
    const sortColumn =
      filter.sort === 'price' ? 'p.price' : filter.sort === 'name' ? 'p.name' : 'p.created_at';
    const phrase = filter.search ? filter.search.trim().toLowerCase() : null;
    const rows = (await base()
      .select(
        'p.*',
        'o.name as office_name',
        'd.logo_key as office_logo_key',
        'd.address as office_address',
        'd.phone as office_phone',
      )
      .modify((qb) => {
        if (phrase && !filter.sort) {
          qb.orderByRaw(
            "CASE WHEN lower(p.name) LIKE ? escape '\\' THEN 0 WHEN lower(p.name) LIKE ? escape '\\' THEN 1 ELSE 2 END",
            [`${escapeLike(phrase)}%`, `%${escapeLike(phrase)}%`],
          );
        }
      })
      .orderBy([
        { column: sortColumn, order: filter.order === 'asc' ? 'asc' : 'desc' },
        { column: 'p.id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as Array<
      VeterinaryOfficeProductRow & {
        office_name: string;
        office_logo_key: string | null;
        office_address: string | null;
        office_phone: string | null;
      }
    >;

    return {
      total: Number(countRow?.count ?? 0),
      items: rows.map((r) => ({
        product: rowToVeterinaryOfficeProduct(r),
        office: {
          id: r.organization_id,
          name: r.office_name,
          logoKey: r.office_logo_key,
          address: r.office_address,
          phone: r.office_phone,
        },
      })),
    };
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

  /**
   * Distinct brands / countries of origin across every publicly browsable
   * office's ACTIVE, visible products (same visibility as
   * {@link searchAcrossOffices}) — the cross-office search's filter chips.
   * Bounded to 200 values each.
   */
  async facetsAcrossOffices(): Promise<{ brands: string[]; countries: string[] }> {
    const distinct = async (column: 'brand' | 'country_of_origin'): Promise<string[]> => {
      const rows = (await this.db(`${TABLE} as p`)
        .join('organizations as o', 'o.id', 'p.organization_id')
        .leftJoin('veterinary_office_details as d', 'd.organization_id', 'o.id')
        .where('o.type', 'VETERINARY_OFFICE')
        .where('o.status', 'ACTIVE')
        .where((w) => {
          void w
            .whereNull('d.subscription_end_date')
            .orWhereRaw('d.subscription_end_date >= CURRENT_DATE');
        })
        .where('p.status', 'ACTIVE')
        .where('p.is_hidden', false)
        .whereRaw(`coalesce(trim(p.${column}), '') <> ''`)
        .select(this.db.raw(`min(trim(p.${column})) as value`))
        .groupByRaw(`lower(trim(p.${column}))`)
        .orderByRaw(`lower(trim(p.${column}))`)
        .limit(200)) as { value: string }[];
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

  /** Point an existing gallery row at a new object (replace keeps id + position). */
  async setImageKey(imageId: string, imageKey: string, trx: Knex.Transaction): Promise<void> {
    await trx(IMAGES).where({ id: imageId }).update({ image_key: imageKey });
  }

  /**
   * Is this storage key referenced by ANY product (gallery row or cover)?
   * Guards both directions of a replace: a new key must be unused, and an old
   * object is only deleted once nothing points at it any more.
   */
  async isImageKeyReferenced(imageKey: string, trx?: Knex.Transaction): Promise<boolean> {
    const conn = this.conn(trx);
    const [inGallery, asPrimary] = await Promise.all([
      conn(IMAGES).where({ image_key: imageKey }).first('id'),
      conn(TABLE).where({ primary_image_key: imageKey }).first('id'),
    ]);
    return Boolean(inGallery || asPrimary);
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
