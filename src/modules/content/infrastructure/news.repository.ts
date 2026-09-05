import type { Knex } from 'knex';
import type { NewsStatus, NewsTag } from '../domain/news.constants.js';
import {
  rowToNews,
  type ListAdminNewsFilter,
  type ListNewsFilter,
  type News,
  type NewsCategoryRef,
  type NewsRow,
} from '../domain/news.types.js';

const T = 'news';

export interface NewsWithCategory {
  news: News;
  category: NewsCategoryRef | null;
}

export interface CreateNewsData {
  categoryId: string | null;
  title: string;
  summary: string | null;
  source: string | null;
  isFeatured: boolean;
  tag: NewsTag;
  body: string | null;
  reasonPoints: string[];
  advicePoints: string[];
  alertNote: string | null;
  createdByUserId: string;
}

export interface UpdateNewsData {
  categoryId?: string | null;
  title?: string;
  summary?: string | null;
  source?: string | null;
  isFeatured?: boolean;
  tag?: NewsTag;
  body?: string | null;
  reasonPoints?: string[];
  advicePoints?: string[];
  alertNote?: string | null;
  updatedByUserId: string;
}

type JoinRow = NewsRow & {
  cat_id: string | null;
  cat_slug: string | null;
  cat_name: string | null;
};

function split(row: JoinRow): NewsWithCategory {
  const category: NewsCategoryRef | null =
    row.cat_id && row.cat_slug && row.cat_name
      ? { id: row.cat_id, slug: row.cat_slug, name: row.cat_name }
      : null;
  return { news: rowToNews(row), category };
}

export class NewsRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private base(conn: Knex | Knex.Transaction): Knex.QueryBuilder {
    return conn(`${T} as n`)
      .leftJoin('categories as cat', function joinCat() {
        this.on('cat.id', 'n.category_id').onNull('cat.deleted_at');
      })
      .select('n.*', 'cat.id as cat_id', 'cat.slug as cat_slug', 'cat.name as cat_name');
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<NewsWithCategory | null> {
    const row = (await this.base(this.conn(trx)).where('n.id', id).first()) as JoinRow | undefined;
    return row ? split(row) : null;
  }

  async findFeatured(trx?: Knex.Transaction): Promise<NewsWithCategory | null> {
    const row = (await this.base(this.conn(trx))
      .where('n.is_featured', true)
      .where('n.status', 'PUBLISHED')
      .whereNull('n.deleted_at')
      .orderByRaw('n.published_at desc nulls last, n.id desc')
      .first()) as JoinRow | undefined;
    return row ? split(row) : null;
  }

  async create(data: CreateNewsData, trx: Knex.Transaction): Promise<News> {
    const [row] = (await trx(T)
      .insert({
        category_id: data.categoryId,
        title: data.title,
        summary: data.summary,
        source: data.source,
        is_featured: data.isFeatured,
        tag: data.tag,
        body: data.body,
        reason_points: JSON.stringify(data.reasonPoints),
        advice_points: JSON.stringify(data.advicePoints),
        alert_note: data.alertNote,
        created_by_user_id: data.createdByUserId,
        updated_by_user_id: data.createdByUserId,
      })
      .returning('*')) as NewsRow[];
    if (!row) throw new Error('news insert returned no row');
    return rowToNews(row);
  }

  async update(id: string, patch: UpdateNewsData, trx: Knex.Transaction): Promise<News> {
    const dbPatch: Record<string, unknown> = {
      updated_by_user_id: patch.updatedByUserId,
      updated_at: trx.fn.now(),
    };
    if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.summary !== undefined) dbPatch.summary = patch.summary;
    if (patch.source !== undefined) dbPatch.source = patch.source;
    if (patch.isFeatured !== undefined) dbPatch.is_featured = patch.isFeatured;
    if (patch.tag !== undefined) dbPatch.tag = patch.tag;
    if (patch.body !== undefined) dbPatch.body = patch.body;
    if (patch.reasonPoints !== undefined)
      dbPatch.reason_points = JSON.stringify(patch.reasonPoints);
    if (patch.advicePoints !== undefined)
      dbPatch.advice_points = JSON.stringify(patch.advicePoints);
    if (patch.alertNote !== undefined) dbPatch.alert_note = patch.alertNote;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as NewsRow[];
    if (!row) throw new Error('news not found on update');
    return rowToNews(row);
  }

  async setStatus(
    id: string,
    status: NewsStatus,
    actorUserId: string,
    opts: { setPublishedAt: boolean },
    trx: Knex.Transaction,
  ): Promise<News> {
    const patch: Record<string, unknown> = {
      status,
      updated_by_user_id: actorUserId,
      updated_at: trx.fn.now(),
    };
    if (opts.setPublishedAt) patch.published_at = trx.fn.now();
    const [row] = (await trx(T).where({ id }).update(patch).returning('*')) as NewsRow[];
    if (!row) throw new Error('news not found on status change');
    return rowToNews(row);
  }

  async setDeleted(
    id: string,
    deleted: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<News> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        deleted_at: deleted ? trx.fn.now() : null,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as NewsRow[];
    if (!row) throw new Error('news not found on delete toggle');
    return rowToNews(row);
  }

  async setCoverImage(
    id: string,
    data: { storageKey: string; storageProvider: string; updatedByUserId: string },
    trx: Knex.Transaction,
  ): Promise<News> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        cover_image_storage_key: data.storageKey,
        cover_image_storage_provider: data.storageProvider,
        updated_by_user_id: data.updatedByUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as NewsRow[];
    if (!row) throw new Error('news not found on cover update');
    return rowToNews(row);
  }

  async setGalleryKeys(
    id: string,
    keys: string[],
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<News> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        gallery_keys: keys,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as NewsRow[];
    if (!row) throw new Error('news not found on gallery update');
    return rowToNews(row);
  }

  async adjustBookmarkCount(id: string, delta: number, trx: Knex.Transaction): Promise<number> {
    const [row] = await trx(T)
      .where({ id })
      .update({ bookmark_count: trx.raw('GREATEST(bookmark_count + ?, 0)', [delta]) })
      .returning('bookmark_count');
    return row?.bookmark_count ?? 0;
  }

  // --- lists ------------------------------------------------------

  private applyCommon(
    qb: Knex.QueryBuilder,
    f: { search?: string; categoryId?: string; tag?: NewsTag },
  ): void {
    if (f.categoryId) qb.where('n.category_id', f.categoryId);
    if (f.tag) qb.where('n.tag', f.tag);
    if (f.search && f.search.trim().length > 0) {
      qb.whereRaw("n.search_vector @@ plainto_tsquery('simple', ?)", [f.search.trim()]);
    }
  }

  async listPublic(
    filter: ListNewsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: NewsWithCategory[]; total: number }> {
    const conn = this.conn(trx);
    const scope = (qb: Knex.QueryBuilder): void => {
      qb.where('n.status', 'PUBLISHED').whereNull('n.deleted_at');
      this.applyCommon(qb, filter);
      if (filter.featured) qb.where('n.is_featured', true);
      if (filter.bookmarkedByUserId) {
        qb.whereExists((sub) => {
          sub
            .select(this.db.raw('1'))
            .from('news_bookmarks as nb')
            .whereRaw('nb.news_id = n.id')
            .where('nb.user_id', filter.bookmarkedByUserId as string);
        });
      }
    };

    const countRow = await conn(`${T} as n`)
      .modify(scope)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await this.base(conn)
      .modify(scope)
      .orderByRaw('n.is_featured desc, n.published_at desc nulls last, n.id desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinRow[];

    return { items: rows.map(split), total };
  }

  async listAdmin(
    filter: ListAdminNewsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: NewsWithCategory[]; total: number }> {
    const conn = this.conn(trx);
    const scope = (qb: Knex.QueryBuilder): void => {
      if (filter.status) qb.where('n.status', filter.status);
      if (!filter.includeDeleted) qb.whereNull('n.deleted_at');
      this.applyCommon(qb, filter);
    };

    const countRow = await conn(`${T} as n`)
      .modify(scope)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await this.base(conn)
      .modify(scope)
      .orderByRaw('n.created_at desc, n.id desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinRow[];

    return { items: rows.map(split), total };
  }
}

/** Per-user news bookmarks. Idempotent toggles; the service pairs the write
 *  with the denormalised `news.bookmark_count` update in one transaction. */
export class NewsBookmarkRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async isBookmarked(userId: string, newsId: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)('news_bookmarks')
      .where({ user_id: userId, news_id: newsId })
      .first();
    return Boolean(row);
  }

  async bookmarkedSet(
    userId: string,
    newsIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Set<string>> {
    if (newsIds.length === 0) return new Set();
    const rows: Array<{ news_id: string }> = await this.conn(trx)('news_bookmarks')
      .where('user_id', userId)
      .whereIn('news_id', newsIds)
      .select('news_id');
    return new Set(rows.map((r) => r.news_id));
  }

  /** @returns `true` when a row was inserted, `false` when it already existed. */
  async add(userId: string, newsId: string, trx: Knex.Transaction): Promise<boolean> {
    const inserted = await trx('news_bookmarks')
      .insert({ user_id: userId, news_id: newsId })
      .onConflict(['user_id', 'news_id'])
      .ignore()
      .returning('news_id');
    return inserted.length > 0;
  }

  /** @returns number of rows removed (0 or 1). */
  async remove(userId: string, newsId: string, trx: Knex.Transaction): Promise<number> {
    return trx('news_bookmarks').where({ user_id: userId, news_id: newsId }).del();
  }
}
