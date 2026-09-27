import type { Knex } from 'knex';
import {
  rowToMessage,
  type Message,
  type MessageAttachment,
  type MessageRow,
} from '../domain/chat.types.js';

const TABLE = 'messages';

export interface CreateMessageData {
  conversationId: string;
  senderUserId: string;
  body: string;
  type: 'TEXT' | 'SYSTEM';
  attachment?: MessageAttachment | null;
}

export class MessageRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async create(data: CreateMessageData, trx: Knex.Transaction): Promise<Message> {
    const [row] = (await trx(TABLE)
      .insert({
        conversation_id: data.conversationId,
        sender_user_id: data.senderUserId,
        body: data.body,
        type: data.type,
        attachment_kind: data.attachment?.kind ?? null,
        attachment_storage_key: data.attachment?.storageKey ?? null,
        attachment_file_name: data.attachment?.fileName ?? null,
        attachment_mime_type: data.attachment?.mimeType ?? null,
        attachment_size_bytes: data.attachment?.sizeBytes ?? null,
      })
      .returning('*')) as MessageRow[];
    if (!row) throw new Error('message insert returned no row');
    return rowToMessage(row);
  }

  async findByIdInConversation(
    id: string,
    conversationId: string,
    trx?: Knex.Transaction,
  ): Promise<Message | null> {
    const row = await this.conn(trx)<MessageRow>(TABLE)
      .where({ id, conversation_id: conversationId })
      .first();
    return row ? rowToMessage(row) : null;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Message | null> {
    const row = await this.conn(trx)<MessageRow>(TABLE).where({ id }).first();
    return row ? rowToMessage(row) : null;
  }

  /** One page of a conversation, newest first, deterministic tiebreak on id. */
  async listForConversation(
    conversationId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: Message[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<MessageRow>(TABLE).where('conversation_id', conversationId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: MessageRow[] = await base()
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToMessage), total };
  }

  /** Whether any message (deleted or not) already references this object. */
  async attachmentKeyInUse(storageKey: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)(TABLE)
      .where({ attachment_storage_key: storageKey })
      .first('id');
    return Boolean(row);
  }

  async softDelete(id: string, deletedByUserId: string, trx: Knex.Transaction): Promise<Message> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: trx.fn.now(), deleted_by_user_id: deletedByUserId })
      .returning('*')) as MessageRow[];
    if (!row) {
      const existing = await this.findById(id, trx);
      if (existing) return existing; // already deleted — idempotent
      throw new Error('message not found for delete');
    }
    return rowToMessage(row);
  }
}
