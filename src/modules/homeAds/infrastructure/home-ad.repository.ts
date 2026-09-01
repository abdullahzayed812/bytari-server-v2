import type { Knex } from 'knex';
import {
  rowToHomeAd,
  type HomeAd,
  type HomeAdRow,
  type ListHomeAdsFilter,
} from '../domain/home-ad.types.js';

const T = 'home_ads';

export interface CreateHomeAdData {
  title: string;
  subtitle: string | null;
  sortOrder: number;
  createdByUserId: string;
}

export interface UpdateHomeAdData {
  title?: string;
  subtitle?: string | null;
  sortOrder?: number;
  updatedByUserId: string;
}

export interface SetImageData {
  imageStorageKey: string;
  imageStorageProvider: string;
  updatedByUserId: string;
}

export class HomeAdRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<HomeAd | null> {
    const row = await this.conn(trx)<HomeAdRow>(T).where({ id }).first();
    return row ? rowToHomeAd(row) : null;
  }

  async create(data: CreateHomeAdData, trx: Knex.Transaction): Promise<HomeAd> {
    const [row] = (await trx(T)
      .insert({
        title: data.title,
        subtitle: data.subtitle,
        sort_order: data.sortOrder,
        created_by_user_id: data.createdByUserId,
        updated_by_user_id: data.createdByUserId,
      })
      .returning('*')) as HomeAdRow[];
    if (!row) throw new Error('home_ad insert returned no row');
    return rowToHomeAd(row);
  }

  async update(id: string, patch: UpdateHomeAdData, trx: Knex.Transaction): Promise<HomeAd> {
    const dbPatch: Record<string, unknown> = {
      updated_by_user_id: patch.updatedByUserId,
      updated_at: trx.fn.now(),
    };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.subtitle !== undefined) dbPatch.subtitle = patch.subtitle;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as HomeAdRow[];
    if (!row) throw new Error('home_ad not found on update');
    return rowToHomeAd(row);
  }

  async setActive(
    id: string,
    isActive: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<HomeAd> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        is_active: isActive,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as HomeAdRow[];
    if (!row) throw new Error('home_ad not found on activate/deactivate');
    return rowToHomeAd(row);
  }

  async setImage(id: string, data: SetImageData, trx: Knex.Transaction): Promise<HomeAd> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        image_storage_key: data.imageStorageKey,
        image_storage_provider: data.imageStorageProvider,
        updated_by_user_id: data.updatedByUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as HomeAdRow[];
    if (!row) throw new Error('home_ad not found on image update');
    return rowToHomeAd(row);
  }

  async setDeleted(
    id: string,
    deleted: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<HomeAd> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        deleted_at: deleted ? trx.fn.now() : null,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as HomeAdRow[];
    if (!row) throw new Error('home_ad not found on delete toggle');
    return rowToHomeAd(row);
  }

  async listPublic(trx?: Knex.Transaction): Promise<HomeAd[]> {
    const rows: HomeAdRow[] = await this.conn(trx)<HomeAdRow>(T)
      .where('is_active', true)
      .whereNull('deleted_at')
      .whereNotNull('image_storage_key')
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ]);
    return rows.map(rowToHomeAd);
  }

  async listAdmin(
    filter: ListHomeAdsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: HomeAd[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): void => {
      if (!filter.includeDeleted) qb.whereNull('deleted_at');
    };

    const countRow = await this.conn(trx)<HomeAdRow>(T)
      .modify(apply)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: HomeAdRow[] = await this.conn(trx)<HomeAdRow>(T)
      .modify(apply)
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToHomeAd), total };
  }
}
