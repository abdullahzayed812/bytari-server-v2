import type { Knex } from 'knex';
import {
  rowToVeterinarianStoreCategory,
  type VeterinarianStoreCategory,
  type VeterinarianStoreCategoryRow,
} from '../domain/veterinarian-store.types.js';

const TABLE = 'veterinarian_store_categories';

export interface CreateVeterinarianStoreCategoryData {
  slug: string;
  name: string;
  showOnHome: boolean;
  sortOrder: number;
  status: string;
}

export interface UpdateVeterinarianStoreCategoryData {
  slug?: string;
  name?: string;
  showOnHome?: boolean;
  sortOrder?: number;
  status?: string;
  imageKey?: string | null;
}

export class VeterinarianStoreCategoryRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<VeterinarianStoreCategory | null> {
    const row = await this.conn(trx)<VeterinarianStoreCategoryRow>(TABLE).where({ id }).first();
    return row ? rowToVeterinarianStoreCategory(row) : null;
  }

  async findBySlug(slug: string, trx?: Knex.Transaction): Promise<VeterinarianStoreCategory | null> {
    const row = await this.conn(trx)<VeterinarianStoreCategoryRow>(TABLE).where({ slug }).first();
    return row ? rowToVeterinarianStoreCategory(row) : null;
  }

  async list(
    opts: { activeOnly: boolean; showOnHomeOnly?: boolean } = { activeOnly: true },
  ): Promise<VeterinarianStoreCategory[]> {
    const qb = this.db<VeterinarianStoreCategoryRow>(TABLE);
    if (opts.activeOnly) qb.where('status', 'ACTIVE');
    if (opts.showOnHomeOnly) qb.andWhere('show_on_home', true);
    const rows = await qb.orderBy([
      { column: 'sort_order', order: 'asc' },
      { column: 'name', order: 'asc' },
    ]);
    return rows.map(rowToVeterinarianStoreCategory);
  }

  /** `categoryId -> ACTIVE product count`, for the admin category list. */
  async productCounts(): Promise<Map<string, number>> {
    const rows = (await this.db('veterinarian_store_products')
      .whereNotNull('category_id')
      .andWhere('status', 'ACTIVE')
      .groupBy('category_id')
      .select('category_id')
      .count<{ category_id: string; count: string }[]>({ count: '*' })) as {
      category_id: string;
      count: string;
    }[];
    return new Map(rows.map((r) => [r.category_id, Number(r.count)]));
  }

  async create(data: CreateVeterinarianStoreCategoryData, trx: Knex.Transaction): Promise<VeterinarianStoreCategory> {
    const [row] = (await trx(TABLE)
      .insert({
        slug: data.slug,
        name: data.name,
        show_on_home: data.showOnHome,
        sort_order: data.sortOrder,
        status: data.status,
      })
      .returning('*')) as VeterinarianStoreCategoryRow[];
    if (!row) throw new Error('veterinarian store category insert did not return a row');
    return rowToVeterinarianStoreCategory(row);
  }

  async update(
    id: string,
    patch: UpdateVeterinarianStoreCategoryData,
    trx: Knex.Transaction,
  ): Promise<VeterinarianStoreCategory> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.slug !== undefined) dbPatch.slug = patch.slug;
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.showOnHome !== undefined) dbPatch.show_on_home = patch.showOnHome;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.imageKey !== undefined) dbPatch.image_key = patch.imageKey;

    const [row] = (await trx(TABLE)
      .where({ id })
      .update(dbPatch)
      .returning('*')) as VeterinarianStoreCategoryRow[];
    if (!row) throw new Error('veterinarian store category not found after update');
    return rowToVeterinarianStoreCategory(row);
  }

  async delete(id: string, trx: Knex.Transaction): Promise<void> {
    await trx(TABLE).where({ id }).delete();
  }
}
