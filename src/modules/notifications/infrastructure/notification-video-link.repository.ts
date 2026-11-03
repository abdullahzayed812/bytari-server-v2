import type { Knex } from 'knex';
import type { NotificationVideoLinkKey } from '../domain/notification.constants.js';

const TABLE = 'notification_video_links';

export interface NotificationVideoLinkRow {
  link_key: NotificationVideoLinkKey;
  url: string;
  updated_by_user_id: string | null;
  updated_at: Date;
}

/** One optional video URL per acceptance-notification key. */
export class NotificationVideoLinkRepository {
  constructor(private readonly db: Knex) {}

  listAll(): Promise<NotificationVideoLinkRow[]> {
    return this.db<NotificationVideoLinkRow>(TABLE).select(
      'link_key',
      'url',
      'updated_by_user_id',
      'updated_at',
    );
  }

  async find(
    key: NotificationVideoLinkKey,
    trx?: Knex.Transaction,
  ): Promise<NotificationVideoLinkRow | null> {
    const row = await (trx ?? this.db)<NotificationVideoLinkRow>(TABLE)
      .where({ link_key: key })
      .first();
    return row ?? null;
  }

  async upsert(
    key: NotificationVideoLinkKey,
    url: string,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<NotificationVideoLinkRow> {
    const [row] = await trx<NotificationVideoLinkRow>(TABLE)
      .insert({ link_key: key, url, updated_by_user_id: actorUserId })
      .onConflict('link_key')
      .merge({ url, updated_by_user_id: actorUserId, updated_at: new Date() })
      .returning(['link_key', 'url', 'updated_by_user_id', 'updated_at']);
    if (!row) throw new Error('notification video link upsert did not return a row');
    return row;
  }

  async delete(key: NotificationVideoLinkKey, trx: Knex.Transaction): Promise<boolean> {
    return (await trx(TABLE).where({ link_key: key }).delete()) > 0;
  }
}
