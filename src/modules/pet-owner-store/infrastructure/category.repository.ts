import type { Knex } from 'knex';
import {
  rowToPetStoreCategory,
  type PetStoreCategory,
  type PetStoreCategoryRow,
} from '../domain/pet-owner-store.types.js';

const TABLE = 'pet_owner_store_categories';

export interface CreatePetStoreCategoryData {
  slug: string;
  name: string;
  showOnHome: boolean;
  sortOrder: number;
  status: string;
}

export interface UpdatePetStoreCategoryData {
  slug?: string;
  name?: string;
  showOnHome?: boolean;
  sortOrder?: number;
  status?: string;
  imageKey?: string | null;
}

export class PetStoreCategoryRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<PetStoreCategory | null> {
    const row = await this.conn(trx)<PetStoreCategoryRow>(TABLE).where({ id }).first();
    return row ? rowToPetStoreCategory(row) : null;
  }

  async findBySlug(slug: string, trx?: Knex.Transaction): Promise<PetStoreCategory | null> {
    const row = await this.conn(trx)<PetStoreCategoryRow>(TABLE).where({ slug }).first();
    return row ? rowToPetStoreCategory(row) : null;
  }

  async list(
    opts: { activeOnly: boolean; showOnHomeOnly?: boolean } = { activeOnly: true },
  ): Promise<PetStoreCategory[]> {
    const qb = this.db<PetStoreCategoryRow>(TABLE);
    if (opts.activeOnly) qb.where('status', 'ACTIVE');
    if (opts.showOnHomeOnly) qb.andWhere('show_on_home', true);
    const rows = await qb.orderBy([
      { column: 'sort_order', order: 'asc' },
      { column: 'name', order: 'asc' },
    ]);
    return rows.map(rowToPetStoreCategory);
  }

  /** `categoryId -> ACTIVE product count`, for the admin category list. */
  async productCounts(): Promise<Map<string, number>> {
    const rows = (await this.db('pet_owner_store_products')
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

  async create(data: CreatePetStoreCategoryData, trx: Knex.Transaction): Promise<PetStoreCategory> {
    const [row] = (await trx(TABLE)
      .insert({
        slug: data.slug,
        name: data.name,
        show_on_home: data.showOnHome,
        sort_order: data.sortOrder,
        status: data.status,
      })
      .returning('*')) as PetStoreCategoryRow[];
    if (!row) throw new Error('pet store category insert did not return a row');
    return rowToPetStoreCategory(row);
  }

  async update(
    id: string,
    patch: UpdatePetStoreCategoryData,
    trx: Knex.Transaction,
  ): Promise<PetStoreCategory> {
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
      .returning('*')) as PetStoreCategoryRow[];
    if (!row) throw new Error('pet store category not found after update');
    return rowToPetStoreCategory(row);
  }

  async delete(id: string, trx: Knex.Transaction): Promise<void> {
    await trx(TABLE).where({ id }).delete();
  }
}
