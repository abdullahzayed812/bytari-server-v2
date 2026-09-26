import type { Knex } from 'knex';
import {
  THREAD_PREVIEW_CHARS,
  type ConsultationAnimalType,
  type InquiryCategory,
  type MessageSource,
} from '../domain/thread.constants.js';
import {
  rowToThread,
  rowToThreadMessage,
  type ListThreadsFilter,
  type SupportThread,
  type ThreadMessage,
  type ThreadMessageRow,
  type ThreadRow,
} from '../domain/thread.types.js';

export interface ThreadRepositoryConfig {
  threadTable: string;
  messageTable: string;
  hasAnimal: boolean;
  hasAnimalType: boolean;
  hasCategory: boolean;
}

export interface CreateThreadData {
  createdByUserId: string;
  animalId: string | null;
  animalType?: ConsultationAnimalType | null;
  category?: InquiryCategory | null;
}

export interface CreateThreadMessageData {
  threadId: string;
  senderUserId: string | null;
  source: MessageSource;
  body: string;
  /**
   * Only ever set for a kind whose message table has an `image_keys` column
   * (CONSULTATION / INQUIRY). Leave `undefined` for SUPPORT — `support_thread_messages`
   * has no such column, and `createMessage` only inserts the field when present.
   */
  imageKeys?: string[];
}

/**
 * Generic repository for a support-thread aggregate. One instance is
 * constructed per kind (`consultations` / `inquiries`) with its own table
 * names, so the two domains never share a row.
 */
export class ThreadRepository {
  constructor(
    private readonly db: Knex,
    private readonly cfg: ThreadRepositoryConfig,
  ) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /**
   * `t.*` plus the opening message's excerpt as `first_message_preview` — one
   * correlated sub-select per row (indexed by `thread_id`), so list pages stay
   * a single query. A soft-deleted opener yields `null`.
   */
  private selectWithPreview(conn: Knex | Knex.Transaction): Knex.QueryBuilder {
    const msg = this.cfg.messageTable;
    return conn(`${this.cfg.threadTable} as t`).select(
      't.*',
      conn.raw(
        `(SELECT CASE WHEN m.deleted_at IS NULL THEN left(m.body, ?) END
            FROM ?? AS m WHERE m.thread_id = t.id
            ORDER BY m.created_at ASC, m.id ASC LIMIT 1) AS first_message_preview`,
        [THREAD_PREVIEW_CHARS, msg],
      ),
    );
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<SupportThread | null> {
    const row = (await this.selectWithPreview(this.conn(trx)).where('t.id', id).first()) as
      | ThreadRow
      | undefined;
    return row ? rowToThread(row) : null;
  }

  async create(data: CreateThreadData, trx: Knex.Transaction): Promise<SupportThread> {
    const insert: Record<string, unknown> = { created_by_user_id: data.createdByUserId };
    if (this.cfg.hasAnimal) insert.animal_id = data.animalId;
    if (this.cfg.hasAnimalType) insert.animal_type = data.animalType ?? null;
    if (this.cfg.hasCategory) insert.category = data.category ?? null;
    const [row] = (await trx(this.cfg.threadTable).insert(insert).returning('*')) as ThreadRow[];
    if (!row) throw new Error('thread insert returned no row');
    return rowToThread(row);
  }

  async close(id: string, closedByUserId: string, trx: Knex.Transaction): Promise<SupportThread> {
    const [row] = (await trx(this.cfg.threadTable)
      .where({ id })
      .update({
        status: 'CLOSED',
        closed_at: trx.fn.now(),
        closed_by_user_id: closedByUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as ThreadRow[];
    if (!row) throw new Error('thread not found on close');
    return rowToThread(row);
  }

  async setSenderBlocked(
    id: string,
    blocked: boolean,
    trx: Knex.Transaction,
  ): Promise<SupportThread> {
    const [row] = (await trx(this.cfg.threadTable)
      .where({ id })
      .update({
        sender_blocked_at: blocked ? trx.fn.now() : null,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as ThreadRow[];
    if (!row) throw new Error('thread not found on block toggle');
    return rowToThread(row);
  }

  async touchLastMessageAt(id: string, at: Date, trx: Knex.Transaction): Promise<void> {
    await trx(this.cfg.threadTable)
      .where({ id })
      .update({ last_message_at: at, updated_at: trx.fn.now() });
  }

  async markAiResponded(id: string, trx: Knex.Transaction): Promise<void> {
    await trx(this.cfg.threadTable)
      .where({ id })
      .update({ ai_responded: true, updated_at: trx.fn.now() });
  }

  private applyList(qb: Knex.QueryBuilder, filter: ListThreadsFilter): Knex.QueryBuilder {
    if (filter.status) qb.where('t.status', filter.status);
    if (filter.createdByUserId) qb.where('t.created_by_user_id', filter.createdByUserId);
    if (filter.category && this.cfg.hasCategory) qb.where('t.category', filter.category);
    return qb;
  }

  async list(
    filter: ListThreadsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: SupportThread[]; total: number }> {
    const countRow = (await this.applyList(
      this.conn(trx)(`${this.cfg.threadTable} as t`),
      filter,
    )
      .count({ count: '*' })
      .first()) as { count: string } | undefined;
    const total = Number(countRow?.count ?? 0);

    const rows = (await this.applyList(this.selectWithPreview(this.conn(trx)), filter)
      .orderByRaw('t.last_message_at desc nulls last')
      .orderBy('t.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as ThreadRow[];

    return { items: rows.map(rowToThread), total };
  }

  // --- messages ------------------------------------------------------

  async createMessage(
    data: CreateThreadMessageData,
    trx: Knex.Transaction,
  ): Promise<ThreadMessage> {
    const insert: Record<string, unknown> = {
      thread_id: data.threadId,
      sender_user_id: data.senderUserId,
      source: data.source,
      body: data.body,
    };
    if (data.imageKeys !== undefined) insert.image_keys = data.imageKeys;
    const [row] = (await trx(this.cfg.messageTable)
      .insert(insert)
      .returning('*')) as ThreadMessageRow[];
    if (!row) throw new Error('message insert returned no row');
    return rowToThreadMessage(row);
  }

  async findMessageInThread(
    id: string,
    threadId: string,
    trx?: Knex.Transaction,
  ): Promise<ThreadMessage | null> {
    const row = await this.conn(trx)<ThreadMessageRow>(this.cfg.messageTable)
      .where({ id, thread_id: threadId })
      .first();
    return row ? rowToThreadMessage(row) : null;
  }

  async listMessages(
    threadId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: ThreadMessage[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<ThreadMessageRow>(this.cfg.messageTable).where('thread_id', threadId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: ThreadMessageRow[] = await base()
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToThreadMessage), total };
  }

  /**
   * The most recent `limit` messages, returned oldest-first. Used to build the
   * AI responder's context so a long thread still includes the latest turn
   * (plain `listMessages` paginates from the OLDEST message).
   */
  async recentMessages(
    threadId: string,
    limit: number,
    trx?: Knex.Transaction,
  ): Promise<ThreadMessage[]> {
    const rows: ThreadMessageRow[] = await this.conn(trx)<ThreadMessageRow>(this.cfg.messageTable)
      .where('thread_id', threadId)
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit);
    return rows.reverse().map(rowToThreadMessage);
  }
}
