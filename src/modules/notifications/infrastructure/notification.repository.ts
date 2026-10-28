import type { Knex } from 'knex';
import {
  rowToNotification,
  type CreateNotificationInput,
  type ListNotificationsFilter,
  type Notification,
  type NotificationRow,
} from '../domain/notification.types.js';

const T = 'notifications';
const SYNDICATE_REPLY_TYPE = 'SYNDICATE_SUBMISSION_RESPONDED';
const SYNDICATE_SUBMISSION_ENTITY = 'SYNDICATE_SUBMISSION';

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

  /**
   * Mark read every unread notification of one user about one entity (e.g.
   * opening a syndicate submission clears its "new submission" alert). Returns
   * the ids that changed, so the caller can emit `notification.read` for each.
   */
  async markReadByEntity(
    userId: string,
    entityType: string,
    entityId: string,
    trx: Knex.Transaction,
  ): Promise<string[]> {
    const rows: Array<{ id: string }> = await trx(T)
      .where({ recipient_user_id: userId, entity_type: entityType, entity_id: entityId })
      .whereNull('read_at')
      .update({ read_at: trx.fn.now(), updated_at: trx.fn.now() })
      .returning('id');
    return rows.map((r) => r.id);
  }

  /** Unread notification count per `entity_id` (only ids with ≥1 unread are present). */
  async countUnreadByEntities(
    userId: string,
    entityType: string,
    entityIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (entityIds.length === 0) return out;
    const rows = (await this.db(T)
      .where({ recipient_user_id: userId, entity_type: entityType })
      .whereIn('entity_id', entityIds)
      .whereNull('read_at')
      .groupBy('entity_id')
      .select('entity_id')
      .count<{ entity_id: string; count: string }[]>({ count: '*' })) as {
      entity_id: string;
      count: string;
    }[];
    for (const r of rows) out.set(r.entity_id, Number(r.count));
    return out;
  }

  /**
   * The user's unread notifications about one pet (`data.animalId`), counted
   * per type — served by `idx_notifications_unread_pet`.
   */
  async countUnreadForAnimalByType(
    userId: string,
    animalId: string,
    types: readonly string[],
  ): Promise<Map<string, number>> {
    const rows = (await this.db(T)
      .where({ recipient_user_id: userId })
      .whereRaw("(data->>'animalId') = ?", [animalId])
      .whereNull('read_at')
      .whereIn('type', types)
      .groupBy('type')
      .select('type')
      .count<{ type: string; count: string }[]>({ count: '*' })) as {
      type: string;
      count: string;
    }[];
    return new Map(rows.map((r) => [r.type, Number(r.count)]));
  }

  /** Mark the user's unread notifications of `types` about one pet read. */
  async markReadForAnimalTypes(
    userId: string,
    animalId: string,
    types: readonly string[],
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx(T)
      .where({ recipient_user_id: userId })
      .whereRaw("(data->>'animalId') = ?", [animalId])
      .whereNull('read_at')
      .whereIn('type', types)
      .update({ read_at: trx.fn.now(), updated_at: trx.fn.now() });
  }

  /**
   * The user's unread "your syndicate submission got a reply" notifications,
   * per submission kind (INQUIRY / REQUEST) — joined to the submission so only
   * replies to the caller's OWN submissions are counted.
   */
  async countUnreadSyndicateRepliesByKind(userId: string): Promise<Map<string, number>> {
    const rows = (await this.db(`${T} as n`)
      .joinRaw('inner join syndicate_submissions as s on s.id::text = n.entity_id')
      .where({
        'n.recipient_user_id': userId,
        'n.type': SYNDICATE_REPLY_TYPE,
        'n.entity_type': SYNDICATE_SUBMISSION_ENTITY,
        's.submitted_by_user_id': userId,
      })
      .whereNull('n.read_at')
      .groupBy('s.kind')
      .select('s.kind')
      .count<{ kind: string; count: string }[]>({ count: '*' })) as {
      kind: string;
      count: string;
    }[];
    return new Map(rows.map((r) => [r.kind, Number(r.count)]));
  }

  /** Mark the user's unread reply notifications for one submission kind read. */
  async markSyndicateRepliesRead(
    userId: string,
    kind: string,
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx(T)
      .where({
        recipient_user_id: userId,
        type: SYNDICATE_REPLY_TYPE,
        entity_type: SYNDICATE_SUBMISSION_ENTITY,
      })
      .whereNull('read_at')
      .whereIn(
        'entity_id',
        trx('syndicate_submissions')
          .where({ submitted_by_user_id: userId, kind })
          .select(trx.raw('id::text')),
      )
      .update({ read_at: trx.fn.now(), updated_at: trx.fn.now() });
  }

  /** Mark every unread notification read. Returns how many rows changed. */
  async markAllRead(userId: string, trx: Knex.Transaction): Promise<number> {
    return trx(T)
      .where({ recipient_user_id: userId })
      .whereNull('read_at')
      .update({ read_at: trx.fn.now(), updated_at: trx.fn.now() });
  }
}
