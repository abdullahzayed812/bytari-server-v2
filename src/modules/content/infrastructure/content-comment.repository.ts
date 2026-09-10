import type { Knex } from 'knex';
import {
  rowToContentComment,
  type ContentComment,
  type ContentCommentRow,
} from '../domain/content.types.js';

const T = 'content_comments';

export interface ContentCommentWithAuthor extends ContentComment {
  author: { firstName: string; lastName: string };
}

/** Flat (no threading) comments on a content item — soft-deletable, own-comment-only. */
export class ContentCommentRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async create(
    contentId: string,
    userId: string,
    body: string,
    trx: Knex.Transaction,
  ): Promise<ContentComment> {
    const [row] = (await trx(T)
      .insert({ content_id: contentId, user_id: userId, body })
      .returning('*')) as ContentCommentRow[];
    if (!row) throw new Error('content comment insert returned no row');
    return rowToContentComment(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<ContentComment | null> {
    const row = await this.conn(trx)<ContentCommentRow>(T).where({ id }).first();
    return row ? rowToContentComment(row) : null;
  }

  async findByIdWithAuthor(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<ContentCommentWithAuthor | null> {
    const row = await this.conn(trx)(`${T} as cc`)
      .join('users as u', 'u.id', 'cc.user_id')
      .where('cc.id', id)
      .select('cc.*', 'u.first_name as u_first_name', 'u.last_name as u_last_name')
      .first();
    if (!row) return null;
    return {
      ...rowToContentComment(row),
      author: { firstName: row.u_first_name, lastName: row.u_last_name },
    };
  }

  async softDelete(id: string, trx: Knex.Transaction): Promise<void> {
    await trx(T).where({ id }).update({ deleted_at: trx.fn.now(), updated_at: trx.fn.now() });
  }

  async countActive(contentId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(T)
      .where({ content_id: contentId })
      .whereNull('deleted_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  async listForContent(
    contentId: string,
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: ContentCommentWithAuthor[]; total: number }> {
    const conn = this.conn(trx);
    const countRow = await conn(T)
      .where({ content_id: contentId })
      .whereNull('deleted_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows = await conn(`${T} as cc`)
      .join('users as u', 'u.id', 'cc.user_id')
      .where('cc.content_id', contentId)
      .whereNull('cc.deleted_at')
      .orderBy('cc.created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .select('cc.*', 'u.first_name as u_first_name', 'u.last_name as u_last_name');

    const items = rows.map((row) => ({
      ...rowToContentComment(row),
      author: { firstName: row.u_first_name, lastName: row.u_last_name },
    }));
    return { items, total };
  }
}
