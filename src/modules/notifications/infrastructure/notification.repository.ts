import type { Knex } from 'knex';
import {
  rowToNotification,
  type CreateNotificationInput,
  type ListNotificationsFilter,
  type Notification,
  type NotificationRow,
} from '../domain/notification.types.js';

const T = 'notifications';

export class NotificationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /**
   * Insert a notification. `ON CONFLICT DO NOTHING` on
   * `(recipient_user_id, source_event_key)` — a repeated domain event never
   * creates a duplicate. Returns `null` when the row already existed.
   */
  async create(
    input: CreateNotificationInput,
    trx: Knex.Transaction,
  ): Promise<Notification | null> {
    const rows = (await trx(T)
      .insert({
        recipient_user_id: input.recipientUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: JSON.stringify(input.data ?? {}),
        actor_user_id: input.actorUserId ?? null,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        source_event_key: input.sourceEventKey ?? null,
      })
      .onConflict()
      .ignore()
      .returning('*')) as NotificationRow[];
    return rows[0] ? rowToNotification(rows[0]) : null;
  }

  async findByIdForUser(
    id: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<Notification | null> {
    const row = await this.conn(trx)<NotificationRow>(T)
      .where({ id, recipient_user_id: userId })
      .first();
    return row ? rowToNotification(row) : null;
  }

  async listForUser(
    userId: string,
    filter: ListNotificationsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: Notification[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<NotificationRow>(T).where('recipient_user_id', userId);
      if (filter.read === true) qb.whereNotNull('read_at');
      if (filter.read === false) qb.whereNull('read_at');
      if (filter.type) qb.where('type', filter.type);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: NotificationRow[] = await base()
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToNotification), total };
  }

  async unreadCount(userId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(T)
      .where({ recipient_user_id: userId })
      .whereNull('read_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  /** Mark one notification read. Idempotent — returns the (already/now) read row. */
  async markRead(id: string, userId: string, trx: Knex.Transaction): Promise<Notification | null> {
    await trx(T)
      .where({ id, recipient_user_id: userId })
      .whereNull('read_at')
      .update({ read_at: trx.fn.now(), updated_at: trx.fn.now() });
    return this.findByIdForUser(id, userId, trx);
  }

  /** Mark every unread notification read. Returns how many rows changed. */
  async markAllRead(userId: string, trx: Knex.Transaction): Promise<number> {
    return trx(T)
      .where({ recipient_user_id: userId })
      .whereNull('read_at')
      .update({ read_at: trx.fn.now(), updated_at: trx.fn.now() });
  }
}
