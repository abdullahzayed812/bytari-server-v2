import type { Knex } from 'knex';
import type { ParticipantRole } from '../domain/chat.constants.js';
import {
  rowToConversation,
  type Conversation,
  type ConversationRow,
  type Participant,
  type ParticipantRow,
} from '../domain/chat.types.js';

const T_CONV = 'conversations';
const T_PART = 'conversation_participants';

export interface CreateConversationData {
  type: 'PET_OWNER_CLINIC' | 'FARM_OWNER_MEMBER';
  organizationId: string;
  petOwnerUserId: string | null;
  memberUserId: string | null;
  createdByUserId: string;
}

export interface CreateParticipantData {
  conversationId: string;
  userId: string;
  role: ParticipantRole;
}

function rowToParticipant(row: ParticipantRow): Participant {
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: row.role as ParticipantRole,
    lastReadMessageId: row.last_read_message_id,
    joinedAt: row.joined_at.toISOString(),
    leftAt: row.left_at ? row.left_at.toISOString() : null,
  };
}

/** Conversations + their explicit participant rows. */
export class ConversationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV).where({ id }).first();
    return row ? rowToConversation(row) : null;
  }

  async findPetOwnerClinic(
    organizationId: string,
    petOwnerUserId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({
        type: 'PET_OWNER_CLINIC',
        organization_id: organizationId,
        pet_owner_user_id: petOwnerUserId,
      })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async findFarmMember(
    organizationId: string,
    memberUserId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({
        type: 'FARM_OWNER_MEMBER',
        organization_id: organizationId,
        member_user_id: memberUserId,
      })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async create(data: CreateConversationData, trx: Knex.Transaction): Promise<Conversation> {
    const [row] = (await trx(T_CONV)
      .insert({
        type: data.type,
        organization_id: data.organizationId,
        pet_owner_user_id: data.petOwnerUserId,
        member_user_id: data.memberUserId,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as ConversationRow[];
    if (!row) throw new Error('conversation insert returned no row');
    return rowToConversation(row);
  }

  async addParticipants(
    participants: CreateParticipantData[],
    trx: Knex.Transaction,
  ): Promise<void> {
    if (participants.length === 0) return;
    await trx(T_PART).insert(
      participants.map((p) => ({
        conversation_id: p.conversationId,
        user_id: p.userId,
        role: p.role,
      })),
    );
  }

  async findParticipant(
    conversationId: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<Participant | null> {
    const row = await this.conn(trx)<ParticipantRow>(T_PART)
      .where({ conversation_id: conversationId, user_id: userId })
      .first();
    return row ? rowToParticipant(row) : null;
  }

  async touchLastMessageAt(conversationId: string, at: Date, trx: Knex.Transaction): Promise<void> {
    await trx(T_CONV)
      .where({ id: conversationId })
      .update({ last_message_at: at, updated_at: trx.fn.now() });
  }

  async setParticipantLastRead(
    conversationId: string,
    userId: string,
    messageId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(T_PART)
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ last_read_message_id: messageId, updated_at: trx.fn.now() });
  }

  /**
   * Candidate conversations the user may be able to see, newest activity first:
   *  - any conversation they have a participant row in, plus
   *  - every PET_OWNER_CLINIC conversation of an org they are an ACTIVE member of.
   *
   * The service still runs a live per-conversation access check on each result
   * (membership can have changed), so this is deliberately permissive.
   */
  async listCandidatesForUser(
    userId: string,
    opts: { organizationId?: string; limit: number },
    trx?: Knex.Transaction,
  ): Promise<Conversation[]> {
    const conn = this.conn(trx);

    const viaParticipant = conn(`${T_PART} as p`)
      .join(`${T_CONV} as c`, 'c.id', 'p.conversation_id')
      .where('p.user_id', userId)
      .modify((qb) => {
        if (opts.organizationId) qb.andWhere('c.organization_id', opts.organizationId);
      })
      .select('c.id as id');

    const viaClinicMembership = conn(`${T_CONV} as c`)
      .join('organization_memberships as m', 'm.organization_id', 'c.organization_id')
      .where('c.type', 'PET_OWNER_CLINIC')
      .andWhere('m.user_id', userId)
      .andWhere('m.status', 'ACTIVE')
      .modify((qb) => {
        if (opts.organizationId) qb.andWhere('c.organization_id', opts.organizationId);
      })
      .select('c.id as id');

    const idRows: Array<{ id: string }> = await viaParticipant.unionAll(
      [viaClinicMembership],
      true,
    );

    const ids = [...new Set(idRows.map((r) => r.id))];
    if (ids.length === 0) return [];

    const rows: ConversationRow[] = await conn<ConversationRow>(T_CONV)
      .whereIn('id', ids)
      .orderByRaw('last_message_at desc nulls last')
      .orderBy('created_at', 'desc')
      .limit(opts.limit);
    return rows.map(rowToConversation);
  }

  /**
   * Unread count per conversation for a user that HAS a participant row.
   * A message counts as unread when it is not soft-deleted, not sent by the
   * user, and newer than the user's `last_read_message_id`.
   */
  async unreadCounts(
    userId: string,
    conversationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (conversationIds.length === 0) return result;

    const rows: Array<{ conversation_id: string; count: string }> = await this.conn(trx)(
      'messages as msg',
    )
      .join('conversation_participants as p', 'p.conversation_id', 'msg.conversation_id')
      .leftJoin('messages as lr', 'lr.id', 'p.last_read_message_id')
      .whereIn('msg.conversation_id', conversationIds)
      .andWhere('p.user_id', userId)
      .andWhere('msg.sender_user_id', '!=', userId)
      .whereNull('msg.deleted_at')
      .andWhere((qb) => {
        qb.whereNull('p.last_read_message_id').orWhereRaw('msg.created_at > lr.created_at');
      })
      .groupBy('msg.conversation_id')
      .select('msg.conversation_id as conversation_id')
      .count<{ conversation_id: string; count: string }[]>({ count: '*' });

    for (const r of rows) result.set(r.conversation_id, Number(r.count));
    return result;
  }
}
