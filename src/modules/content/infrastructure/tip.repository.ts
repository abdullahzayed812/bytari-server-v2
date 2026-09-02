import type { Knex } from 'knex';
import type { TipPriority, TipStatus } from '../domain/tip.constants.js';
import {
  rowToTip,
  type ListAdminTipsFilter,
  type ListTipsFilter,
  type Tip,
  type TipCategoryRef,
  type TipRow,
} from '../domain/tip.types.js';

const T = 'content_tips';

export interface TipWithCategory {
  tip: Tip;
  category: TipCategoryRef | null;
}

export interface CreateTipData {
  categoryId: string | null;
  title: string;
  summary: string | null;
  readMinutes: number | null;
  priority: TipPriority;
  bodyIntro: string | null;
  keyPoints: string[];
  warningPoints: string[];
  vetAdvice: string | null;
  createdByUserId: string;
}

export interface UpdateTipData {
  categoryId?: string | null;
  title?: string;
  summary?: string | null;
  readMinutes?: number | null;
  priority?: TipPriority;
  bodyIntro?: string | null;
  keyPoints?: string[];
  warningPoints?: string[];
  vetAdvice?: string | null;
  updatedByUserId: string;
}

type JoinRow = TipRow & { cat_id: string | null; cat_slug: string | null; cat_name: string | null };

function split(row: JoinRow): TipWithCategory {
  const category: TipCategoryRef | null =
    row.cat_id && row.cat_slug && row.cat_name
      ? { id: row.cat_id, slug: row.cat_slug, name: row.cat_name }
      : null;
  return { tip: rowToTip(row), category };
}

export class TipRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private base(conn: Knex | Knex.Transaction): Knex.QueryBuilder {
    return conn(`${T} as t`)
      .leftJoin('categories as cat', function joinCat() {
        this.on('cat.id', 't.category_id').onNull('cat.deleted_at');
      })
      .select('t.*', 'cat.id as cat_id', 'cat.slug as cat_slug', 'cat.name as cat_name');
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<TipWithCategory | null> {
    const row = (await this.base(this.conn(trx)).where('t.id', id).first()) as JoinRow | undefined;
    return row ? split(row) : null;
  }

  async findTipOfDay(trx?: Knex.Transaction): Promise<TipWithCategory | null> {
    const row = (await this.base(this.conn(trx))
      .where('t.is_tip_of_day', true)
      .where('t.status', 'PUBLISHED')
      .whereNull('t.deleted_at')
      .first()) as JoinRow | undefined;
    return row ? split(row) : null;
  }

  async create(data: CreateTipData, trx: Knex.Transaction): Promise<Tip> {
    const [row] = (await trx(T)
      .insert({
        category_id: data.categoryId,
        title: data.title,
        summary: data.summary,
        read_minutes: data.readMinutes,
        priority: data.priority,
        body_intro: data.bodyIntro,
        key_points: JSON.stringify(data.keyPoints),
        warning_points: JSON.stringify(data.warningPoints),
        vet_advice: data.vetAdvice,
        created_by_user_id: data.createdByUserId,
        updated_by_user_id: data.createdByUserId,
      })
      .returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips insert returned no row');
    return rowToTip(row);
  }

  async update(id: string, patch: UpdateTipData, trx: Knex.Transaction): Promise<Tip> {
    const dbPatch: Record<string, unknown> = {
      updated_by_user_id: patch.updatedByUserId,
      updated_at: trx.fn.now(),
    };
    if (patch.categoryId !== undefined) dbPatch.category_id = patch.categoryId;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.summary !== undefined) dbPatch.summary = patch.summary;
    if (patch.readMinutes !== undefined) dbPatch.read_minutes = patch.readMinutes;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.bodyIntro !== undefined) dbPatch.body_intro = patch.bodyIntro;
    if (patch.keyPoints !== undefined) dbPatch.key_points = JSON.stringify(patch.keyPoints);
    if (patch.warningPoints !== undefined)
      dbPatch.warning_points = JSON.stringify(patch.warningPoints);
    if (patch.vetAdvice !== undefined) dbPatch.vet_advice = patch.vetAdvice;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips not found on update');
    return rowToTip(row);
  }

  async setStatus(
    id: string,
    status: TipStatus,
    actorUserId: string,
    opts: { setPublishedAt: boolean },
    trx: Knex.Transaction,
  ): Promise<Tip> {
    const patch: Record<string, unknown> = {
      status,
      updated_by_user_id: actorUserId,
      updated_at: trx.fn.now(),
    };
    if (opts.setPublishedAt) patch.published_at = trx.fn.now();
    const [row] = (await trx(T).where({ id }).update(patch).returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips not found on status change');
    return rowToTip(row);
  }

  async setDeleted(
    id: string,
    deleted: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<Tip> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        deleted_at: deleted ? trx.fn.now() : null,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips not found on delete toggle');
    return rowToTip(row);
  }

  async setCoverImage(
    id: string,
    data: { storageKey: string; storageProvider: string; updatedByUserId: string },
    trx: Knex.Transaction,
  ): Promise<Tip> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        cover_image_storage_key: data.storageKey,
        cover_image_storage_provider: data.storageProvider,
        updated_by_user_id: data.updatedByUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips not found on cover update');
    return rowToTip(row);
  }

  /** Clear `is_tip_of_day` on every other tip; set it on `id`. */
  async setTipOfDay(id: string, actorUserId: string, trx: Knex.Transaction): Promise<Tip> {
    await trx(T)
      .whereNot({ id })
      .where('is_tip_of_day', true)
      .update({ is_tip_of_day: false, updated_by_user_id: actorUserId, updated_at: trx.fn.now() });
    const [row] = (await trx(T)
      .where({ id })
      .update({ is_tip_of_day: true, updated_by_user_id: actorUserId, updated_at: trx.fn.now() })
      .returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips not found on tip-of-day set');
    return rowToTip(row);
  }

  async clearTipOfDay(id: string, actorUserId: string, trx: Knex.Transaction): Promise<Tip> {
    const [row] = (await trx(T)
      .where({ id })
      .update({ is_tip_of_day: false, updated_by_user_id: actorUserId, updated_at: trx.fn.now() })
      .returning('*')) as TipRow[];
    if (!row) throw new Error('content_tips not found on tip-of-day clear');
    return rowToTip(row);
  }

  async adjustHelpfulCount(id: string, delta: number, trx: Knex.Transaction): Promise<number> {
    const [row] = await trx(T)
      .where({ id })
      .update({ helpful_count: trx.raw('GREATEST(helpful_count + ?, 0)', [delta]) })
      .returning('helpful_count');
    return row?.helpful_count ?? 0;
  }

  // --- lists ------------------------------------------------------

  private applyCommon(
    qb: Knex.QueryBuilder,
    f: { search?: string; categoryId?: string; priority?: TipPriority },
  ): void {
    if (f.categoryId) qb.where('t.category_id', f.categoryId);
    if (f.priority) qb.where('t.priority', f.priority);
    if (f.search && f.search.trim().length > 0) {
      qb.whereRaw("t.search_vector @@ plainto_tsquery('simple', ?)", [f.search.trim()]);
    }
  }

  async listPublic(
    filter: ListTipsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: TipWithCategory[]; total: number }> {
    const conn = this.conn(trx);
    const scope = (qb: Knex.QueryBuilder): void => {
      qb.where('t.status', 'PUBLISHED').whereNull('t.deleted_at');
      this.applyCommon(qb, filter);
      if (filter.bookmarkedByUserId) {
        qb.whereExists((sub) => {
          sub
            .select(this.db.raw('1'))
            .from('tip_bookmarks as tb')
            .whereRaw('tb.tip_id = t.id')
            .where('tb.user_id', filter.bookmarkedByUserId as string);
        });
      }
    };

    const countRow = await conn(`${T} as t`)
      .modify(scope)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await this.base(conn)
      .modify(scope)
      .orderByRaw('t.is_tip_of_day desc, t.published_at desc nulls last, t.id desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinRow[];

    return { items: rows.map(split), total };
  }

  async listAdmin(
    filter: ListAdminTipsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: TipWithCategory[]; total: number }> {
    const conn = this.conn(trx);
    const scope = (qb: Knex.QueryBuilder): void => {
      if (filter.status) qb.where('t.status', filter.status);
      if (!filter.includeDeleted) qb.whereNull('t.deleted_at');
      this.applyCommon(qb, filter);
    };

    const countRow = await conn(`${T} as t`)
      .modify(scope)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await this.base(conn)
      .modify(scope)
      .orderByRaw('t.created_at desc, t.id desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as JoinRow[];

    return { items: rows.map(split), total };
  }
}
