import type { Knex } from 'knex';
import type {
  ConversationStatus,
  ConversationSubjectType,
  ConversationType,
  ParticipantRole,
} from '../domain/chat.constants.js';
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
  type: ConversationType;
  organizationId: string | null;
  petOwnerUserId: string | null;
  memberUserId: string | null;
  veterinarianUserId?: string | null;
  subjectType?: ConversationSubjectType | null;
  subjectId?: string | null;
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
    notificationsMuted: row.notifications_muted,
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

  async findPetOwnerVeterinaryOffice(
    organizationId: string,
    petOwnerUserId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({
        type: 'PET_OWNER_VETERINARY_OFFICE',
        organization_id: organizationId,
        pet_owner_user_id: petOwnerUserId,
      })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async findSyndicateMember(
    organizationId: string,
    memberUserId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({
        type: 'SYNDICATE_MEMBER',
        organization_id: organizationId,
        pet_owner_user_id: memberUserId,
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

  /** A room's single discussion thread — one per CHAT_ROOM organization. */
  async findChatRoomConversation(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({ type: 'CHAT_ROOM', organization_id: organizationId })
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
        veterinarian_user_id: data.veterinarianUserId ?? null,
        subject_type: data.subjectType ?? null,
        subject_id: data.subjectId ?? null,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as ConversationRow[];
    if (!row) throw new Error('conversation insert returned no row');
    return rowToConversation(row);
  }

  /** The farm-colleagues conversation for an UNORDERED pair of members. */
  async findFarmMemberDirect(
    organizationId: string,
    userA: string,
    userB: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({ type: 'FARM_MEMBER_DIRECT', organization_id: organizationId })
      .andWhere((qb) => {
        qb.where({ pet_owner_user_id: userA, member_user_id: userB }).orWhere({
          pet_owner_user_id: userB,
          member_user_id: userA,
        });
      })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async findPublicationContact(
    publicationId: string,
    interestedUserId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({
        type: 'ANIMAL_PUBLICATION',
        subject_id: publicationId,
        pet_owner_user_id: interestedUserId,
      })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async findPetOwnerVeterinarian(
    petOwnerUserId: string,
    veterinarianUserId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({
        type: 'PET_OWNER_VETERINARIAN',
        pet_owner_user_id: petOwnerUserId,
        veterinarian_user_id: veterinarianUserId,
      })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async findBySubject(
    subjectType: string,
    subjectId: string,
    trx?: Knex.Transaction,
  ): Promise<Conversation | null> {
    const row = await this.conn(trx)<ConversationRow>(T_CONV)
      .where({ subject_type: subjectType, subject_id: subjectId })
      .first();
    return row ? rowToConversation(row) : null;
  }

  async setSubject(
    conversationId: string,
    subjectType: string,
    subjectId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(T_CONV)
      .where({ id: conversationId })
      .update({ subject_type: subjectType, subject_id: subjectId, updated_at: trx.fn.now() });
  }

  async setStatus(
    conversationId: string,
    status: 'OPEN' | 'COMPLETED' | 'CLOSED',
    trx: Knex.Transaction,
  ): Promise<Conversation> {
    const [row] = (await trx(T_CONV)
      .where({ id: conversationId })
      .update({ status, updated_at: trx.fn.now() })
      .returning('*')) as ConversationRow[];
    if (!row) throw new Error('conversation not found on setStatus');
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

  /** Admin oversight — every participant row (including those who left), oldest first. */
  async listParticipantsForAdmin(
    conversationId: string,
    trx?: Knex.Transaction,
  ): Promise<Participant[]> {
    const rows = await this.conn(trx)<ParticipantRow>(T_PART)
      .where({ conversation_id: conversationId })
      .orderBy('joined_at', 'asc');
    return rows.map(rowToParticipant);
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
    // Only ever ADVANCE the read pointer: marking an older message (a stale
    // client, a second device) must not resurrect messages already read.
    await trx(T_PART)
      .where({ conversation_id: conversationId, user_id: userId })
      .andWhere((qb) => {
        qb.whereNull('last_read_message_id').orWhereRaw(
          `(SELECT created_at FROM messages WHERE id = ?) >=
             (SELECT created_at FROM messages WHERE id = ${T_PART}.last_read_message_id)`,
          [messageId],
        );
      })
      .update({ last_read_message_id: messageId, updated_at: trx.fn.now() });
  }

  /** CHAT_ROOM only — "mute this room's notifications" for one member. */
  async setParticipantMuted(
    conversationId: string,
    userId: string,
    muted: boolean,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.conn(trx)(T_PART)
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ notifications_muted: muted, updated_at: (trx ?? this.db).fn.now() });
  }

  /** Soft-leave — marks the participant row `left_at`, does not delete it. */
  async leaveParticipant(
    conversationId: string,
    userId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(T_PART)
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ left_at: trx.fn.now(), updated_at: trx.fn.now() });
  }

  /** Re-activates a participant row that previously left (rejoining a room). */
  async rejoinParticipant(
    conversationId: string,
    userId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(T_PART)
      .where({ conversation_id: conversationId, user_id: userId })
      .update({ left_at: null, updated_at: trx.fn.now() });
  }

  /** Active (not left), non-muted member ids of a conversation — for notification fan-out. */
  async listActiveParticipantUserIds(
    conversationId: string,
    opts: { excludeUserId?: string; excludeMuted?: boolean; limit: number },
    trx?: Knex.Transaction,
  ): Promise<string[]> {
    const qb = this.conn(trx)<ParticipantRow>(T_PART)
      .where({ conversation_id: conversationId })
      .whereNull('left_at');
    if (opts.excludeUserId) qb.andWhereNot('user_id', opts.excludeUserId);
    if (opts.excludeMuted) qb.andWhere('notifications_muted', false);
    const rows = await qb.limit(opts.limit).select('user_id');
    return rows.map((r) => r.user_id);
  }

  /** ACTIVE (not left) member count of a conversation — a room's "N عضو". */
  async countActiveParticipants(conversationId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)(T_PART)
      .where({ conversation_id: conversationId })
      .whereNull('left_at')
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
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

    // Org-side-resolved-live types (no participant row for that side) — CLINIC,
    // VETERINARY_OFFICE and SYNDICATE_MEMBER, same shape.
    const viaOrgMembership = conn(`${T_CONV} as c`)
      .join('organization_memberships as m', 'm.organization_id', 'c.organization_id')
      .whereIn('c.type', ['PET_OWNER_CLINIC', 'PET_OWNER_VETERINARY_OFFICE', 'SYNDICATE_MEMBER'])
      .andWhere('m.user_id', userId)
      .andWhere('m.status', 'ACTIVE')
      .modify((qb) => {
        if (opts.organizationId) qb.andWhere('c.organization_id', opts.organizationId);
      })
      .select('c.id as id');

    const idRows: Array<{ id: string }> = await viaParticipant.unionAll([viaOrgMembership], true);

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

  /** Admin oversight — every conversation platform-wide, newest activity first. */
  /**
   * Admin oversight list ("إدارة المحادثات"): every conversation, newest
   * activity first, with optional filters. `search` matches the conversation's
   * name (its organization / clinic / office / room name) OR any person in it —
   * the relationship columns (pet owner / member / veterinarian) and explicit
   * participant rows — by first, last or full name. EXISTS sub-queries keep it
   * one row per conversation, so count + page stay exact.
   */
  async listAllForAdmin(
    filter: {
      page: number;
      pageSize: number;
      search?: string;
      type?: ConversationType;
      status?: ConversationStatus;
      organizationId?: string;
    },
    trx?: Knex.Transaction,
  ): Promise<{ items: Conversation[]; total: number }> {
    const conn = this.conn(trx);
    const term = filter.search?.trim();
    const like = term ? `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const nameMatches = (alias: string): string =>
      `(${alias}.first_name ILIKE ? OR ${alias}.last_name ILIKE ? OR ` +
      `(${alias}.first_name || ' ' || ${alias}.last_name) ILIKE ?)`;

    const scoped = (): Knex.QueryBuilder => {
      const qb = conn(`${T_CONV} as c`);
      if (filter.type) void qb.where('c.type', filter.type);
      if (filter.status) void qb.where('c.status', filter.status);
      if (filter.organizationId) void qb.where('c.organization_id', filter.organizationId);
      if (like) {
        void qb.andWhere((w) => {
          void w
            .whereExists((sub) => {
              void sub
                .select(conn.raw('1'))
                .from('organizations as o')
                .whereRaw('o.id = c.organization_id')
                .whereILike('o.name', like);
            })
            .orWhereExists((sub) => {
              void sub
                .select(conn.raw('1'))
                .from('users as u')
                .whereRaw('u.id IN (c.pet_owner_user_id, c.member_user_id, c.veterinarian_user_id)')
                .whereRaw(nameMatches('u'), [like, like, like]);
            })
            .orWhereExists((sub) => {
              void sub
                .select(conn.raw('1'))
                .from(`${T_PART} as p`)
                .join('users as pu', 'pu.id', 'p.user_id')
                .whereRaw('p.conversation_id = c.id')
                .whereRaw(nameMatches('pu'), [like, like, like]);
            });
        });
      }
      return qb;
    };

    const countRow = await scoped().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows = (await scoped()
      .select('c.*')
      .orderByRaw('c.last_message_at desc nulls last')
      .orderBy('c.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as ConversationRow[];

    return { items: rows.map(rowToConversation), total };
  }

  /**
   * Display names for the admin list — organization names, every person on a
   * relationship column, and each conversation's participant count — in three
   * batched queries for one page (no N+1).
   */
  async adminListContext(
    conversations: Conversation[],
    trx?: Knex.Transaction,
  ): Promise<{
    organizations: Map<string, string>;
    users: Map<string, { firstName: string; lastName: string }>;
    participantCounts: Map<string, number>;
  }> {
    const conn = this.conn(trx);
    const orgIds = [
      ...new Set(conversations.map((c) => c.organizationId).filter((x): x is string => !!x)),
    ];
    const userIds = [
      ...new Set(
        conversations
          .flatMap((c) => [c.petOwnerUserId, c.memberUserId, c.veterinarianUserId])
          .filter((x): x is string => !!x),
      ),
    ];
    const ids = conversations.map((c) => c.id);
    const [orgRows, userRows, countRows] = await Promise.all([
      orgIds.length
        ? conn('organizations').whereIn('id', orgIds).select('id', 'name')
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      userIds.length
        ? conn('users').whereIn('id', userIds).select('id', 'first_name', 'last_name')
        : Promise.resolve([] as Array<{ id: string; first_name: string; last_name: string }>),
      ids.length
        ? conn(T_PART)
            .whereIn('conversation_id', ids)
            .whereNull('left_at')
            .groupBy('conversation_id')
            .select('conversation_id')
            .count<Array<{ conversation_id: string; count: string }>>({ count: '*' })
        : Promise.resolve([] as Array<{ conversation_id: string; count: string }>),
    ]);
    return {
      organizations: new Map(
        (orgRows as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]),
      ),
      users: new Map(
        (userRows as Array<{ id: string; first_name: string; last_name: string }>).map((u) => [
          u.id,
          { firstName: u.first_name, lastName: u.last_name },
        ]),
      ),
      participantCounts: new Map(countRows.map((r) => [r.conversation_id, Number(r.count)])),
    };
  }
}
