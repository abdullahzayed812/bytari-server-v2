import type { Knex } from 'knex';
import {
  rowToCategory,
  rowToContent,
  type Category,
  type CategoryRow,
  type Content,
  type ContentRow,
  type ListContentFilter,
} from '../domain/content.types.js';
import type { ContentStatus, ContentType } from '../domain/content.constants.js';

const T = 'contents';
const T_CC = 'content_categories';

export interface CreateContentData {
  type: ContentType;
  title: string;
  description: string | null;
  body: string | null;
  authorName: string | null;
  language: string | null;
  pageCount: number | null;
  publishYear: number | null;
  createdByUserId: string;
}

export interface UpdateContentData {
  title?: string;
  description?: string | null;
  body?: string | null;
  authorName?: string | null;
  language?: string | null;
  pageCount?: number | null;
  publishYear?: number | null;
  updatedByUserId: string;
}

export class ContentRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Content | null> {
    const row = await this.conn(trx)<ContentRow>(T).where({ id }).first();
    return row ? rowToContent(row) : null;
  }

  async create(data: CreateContentData, trx: Knex.Transaction): Promise<Content> {
    const [row] = (await trx(T)
      .insert({
        type: data.type,
        title: data.title,
        description: data.description,
        body: data.body,
        author_name: data.authorName,
        language: data.language,
        page_count: data.pageCount,
        publish_year: data.publishYear,
        created_by_user_id: data.createdByUserId,
        updated_by_user_id: data.createdByUserId,
      })
      .returning('*')) as ContentRow[];
    if (!row) throw new Error('content insert returned no row');
    return rowToContent(row);
  }

  async update(id: string, patch: UpdateContentData, trx: Knex.Transaction): Promise<Content> {
    const dbPatch: Record<string, unknown> = {
      updated_by_user_id: patch.updatedByUserId,
      updated_at: trx.fn.now(),
    };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.body !== undefined) dbPatch.body = patch.body;
    if (patch.authorName !== undefined) dbPatch.author_name = patch.authorName;
    if (patch.language !== undefined) dbPatch.language = patch.language;
    if (patch.pageCount !== undefined) dbPatch.page_count = patch.pageCount;
    if (patch.publishYear !== undefined) dbPatch.publish_year = patch.publishYear;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as ContentRow[];
    if (!row) throw new Error('content not found on update');
    return rowToContent(row);
  }

  /**
   * Adjust the denormalised `like_count` / `comment_count` by a signed delta,
   * returning the new value. Deliberately does NOT touch `updated_at` — that
   * reflects an actual content edit, not passive engagement.
   */
  async adjustLikeCount(id: string, delta: number, trx: Knex.Transaction): Promise<number> {
    const [row] = (await trx(T)
      .where({ id })
      .update({ like_count: trx.raw('like_count + ?', [delta]) })
      .returning('like_count')) as Array<{ like_count: number }>;
    if (!row) throw new Error('content not found on like-count adjust');
    return row.like_count;
  }

  async adjustCommentCount(id: string, delta: number, trx: Knex.Transaction): Promise<number> {
    const [row] = (await trx(T)
      .where({ id })
      .update({ comment_count: trx.raw('comment_count + ?', [delta]) })
      .returning('comment_count')) as Array<{ comment_count: number }>;
    if (!row) throw new Error('content not found on comment-count adjust');
    return row.comment_count;
  }

  async incrementViewCount(id: string, trx?: Knex.Transaction): Promise<void> {
    await this.conn(trx)(T)
      .where({ id })
      .update({ view_count: this.conn(trx).raw('view_count + 1') });
  }

  async setStatus(
    id: string,
    status: ContentStatus,
    actorUserId: string,
    opts: { setPublishedAt: boolean },
    trx: Knex.Transaction,
  ): Promise<Content> {
    const patch: Record<string, unknown> = {
      status,
      updated_by_user_id: actorUserId,
      updated_at: trx.fn.now(),
    };
    if (opts.setPublishedAt) patch.published_at = trx.fn.now();
    const [row] = (await trx(T).where({ id }).update(patch).returning('*')) as ContentRow[];
    if (!row) throw new Error('content not found on status change');
    return rowToContent(row);
  }

  async setDeleted(
    id: string,
    deleted: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<Content> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        deleted_at: deleted ? trx.fn.now() : null,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as ContentRow[];
    if (!row) throw new Error('content not found on delete toggle');
    return rowToContent(row);
  }

  private applyFilters(qb: Knex.QueryBuilder, f: ListContentFilter, publicOnly: boolean): void {
    if (publicOnly) {
      qb.where('c.status', 'PUBLISHED').whereNull('c.deleted_at');
    } else {
      if (f.status) qb.where('c.status', f.status);
      if (!f.includeDeleted) qb.whereNull('c.deleted_at');
    }
    if (f.type) qb.where('c.type', f.type);
    if (f.categoryId) {
      qb.whereExists((sub) => {
        sub
          .select(this.db.raw('1'))
          .from(`${T_CC} as cc`)
          .whereRaw('cc.content_id = c.id')
          .where('cc.category_id', f.categoryId as string);
      });
    }
    if (f.search && f.search.trim().length > 0) {
      qb.whereRaw("c.search_vector @@ plainto_tsquery('simple', ?)", [f.search.trim()]);
    }
    if (f.bookmarkedOnly && f.viewerId) {
      qb.whereExists((sub) => {
        sub
          .select(this.db.raw('1'))
          .from('content_bookmarks as cb')
          .whereRaw('cb.content_id = c.id')
          .where('cb.user_id', f.viewerId as string);
      });
    }
  }

  private orderFor(filter: ListContentFilter, publicOnly: boolean): string {
    if (filter.sort === 'mostRead') return 'c.view_count desc, c.id desc';
    if (filter.sort === 'topRated') {
      return `(select avg(rating) from content_ratings cr where cr.content_id = c.id) desc nulls last, c.id desc`;
    }
    return publicOnly ? 'c.published_at desc nulls last, c.id desc' : 'c.created_at desc, c.id desc';
  }

  async list(
    filter: ListContentFilter,
    publicOnly: boolean,
    trx?: Knex.Transaction,
  ): Promise<{ items: Content[]; total: number }> {
    const countRow = await this.conn(trx)<ContentRow>(`${T} as c`)
      .modify((qb) => this.applyFilters(qb, filter, publicOnly))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: ContentRow[] = await this.conn(trx)<ContentRow>(`${T} as c`)
      .modify((qb) => this.applyFilters(qb, filter, publicOnly))
      .select('c.*')
      .orderByRaw(this.orderFor(filter, publicOnly))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToContent), total };
  }

  // --- category associations -------------------------------------

  async categoriesFor(contentId: string, trx?: Knex.Transaction): Promise<Category[]> {
    const rows: CategoryRow[] = await this.conn(trx)<CategoryRow>(`${T_CC} as cc`)
      .join('categories as cat', 'cat.id', 'cc.category_id')
      .where('cc.content_id', contentId)
      .whereNull('cat.deleted_at')
      .orderBy('cat.name')
      .select('cat.*');
    return rows.map(rowToCategory);
  }

  async replaceCategories(
    contentId: string,
    categoryIds: string[],
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(T_CC).where({ content_id: contentId }).del();
    if (categoryIds.length > 0) {
      await trx(T_CC).insert(
        [...new Set(categoryIds)].map((category_id) => ({ content_id: contentId, category_id })),
      );
    }
  }
}
