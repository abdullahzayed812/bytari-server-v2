import type { Knex } from 'knex';
import type { MessageSource } from '../domain/thread.constants.js';
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
}

export interface CreateThreadData {
  createdByUserId: string;
  animalId: string | null;
}

export interface CreateThreadMessageData {
  threadId: string;
  senderUserId: string | null;
  source: MessageSource;
  body: string;
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

  async findById(id: string, trx?: Knex.Transaction): Promise<SupportThread | null> {
    const row = await this.conn(trx)<ThreadRow>(this.cfg.threadTable).where({ id }).first();
    return row ? rowToThread(row) : null;
  }

  async create(data: CreateThreadData, trx: Knex.Transaction): Promise<SupportThread> {
    const insert: Record<string, unknown> = { created_by_user_id: data.createdByUserId };
    if (this.cfg.hasAnimal) insert.animal_id = data.animalId;
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
    if (filter.status) qb.where('status', filter.status);
    if (filter.createdByUserId) qb.where('created_by_user_id', filter.createdByUserId);
    return qb;
  }

  async list(
    filter: ListThreadsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: SupportThread[]; total: number }> {
    const countRow = await this.applyList(this.conn(trx)<ThreadRow>(this.cfg.threadTable), filter)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: ThreadRow[] = await this.applyList(
      this.conn(trx)<ThreadRow>(this.cfg.threadTable),
      filter,
    )
      .orderByRaw('last_message_at desc nulls last')
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToThread), total };
  }

  // --- messages ------------------------------------------------------

  async createMessage(
    data: CreateThreadMessageData,
    trx: Knex.Transaction,
  ): Promise<ThreadMessage> {
    const [row] = (await trx(this.cfg.messageTable)
      .insert({
        thread_id: data.threadId,
        sender_user_id: data.senderUserId,
        source: data.source,
        body: data.body,
      })
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
