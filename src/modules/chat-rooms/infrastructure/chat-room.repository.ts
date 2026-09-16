import type { Knex } from 'knex';

interface ChatRoomDetailRow {
  organization_id: string;
  logo_key: string | null;
  rules: string | null;
  pinned_message_id: string | null;
}

export interface ChatRoomDetails {
  organizationId: string;
  logoKey: string | null;
  rules: string | null;
  pinnedMessageId: string | null;
}

function toDetails(row: ChatRoomDetailRow): ChatRoomDetails {
  return {
    organizationId: row.organization_id,
    logoKey: row.logo_key,
    rules: row.rules,
    pinnedMessageId: row.pinned_message_id,
  };
}

/**
 * Batched, room-specific reads that don't fit any existing single-org
 * repository (`OrganizationRepository`/`MembershipRepository` are scoped to
 * one organization at a time) — used by the rooms LIST endpoint so a page of
 * N rooms costs a fixed handful of queries, never N+1.
 */
export class ChatRoomRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findDetailsByIds(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, ChatRoomDetails>> {
    if (organizationIds.length === 0) return new Map();
    const rows = await this.conn(trx)<ChatRoomDetailRow>('chat_room_details')
      .whereIn('organization_id', organizationIds)
      .select('organization_id', 'logo_key', 'rules', 'pinned_message_id');
    return new Map(rows.map((r) => [r.organization_id, toDetails(r)]));
  }

  async findDetails(organizationId: string, trx?: Knex.Transaction): Promise<ChatRoomDetails | null> {
    const map = await this.findDetailsByIds([organizationId], trx);
    return map.get(organizationId) ?? null;
  }

  async countActiveMembersByOrgIds(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, number>> {
    if (organizationIds.length === 0) return new Map();
    const rows = await this.conn(trx)('organization_memberships')
      .whereIn('organization_id', organizationIds)
      .andWhere('status', 'ACTIVE')
      .groupBy('organization_id')
      .select('organization_id')
      .count<{ organization_id: string; count: string }[]>({ count: '*' });
    return new Map(rows.map((r) => [r.organization_id, Number(r.count)]));
  }

  async countActiveMembers(organizationId: string, trx?: Knex.Transaction): Promise<number> {
    const map = await this.countActiveMembersByOrgIds([organizationId], trx);
    return map.get(organizationId) ?? 0;
  }

  /** Which of `organizationIds` the user has an ACTIVE membership in. */
  async findActiveMembershipOrgIds(
    userId: string,
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Set<string>> {
    if (organizationIds.length === 0) return new Set();
    const rows = await this.conn(trx)('organization_memberships')
      .where('user_id', userId)
      .andWhere('status', 'ACTIVE')
      .whereIn('organization_id', organizationIds)
      .select('organization_id');
    return new Set(rows.map((r: { organization_id: string }) => r.organization_id));
  }

  /** The CHAT_ROOM conversation id backing each room organization. */
  async findConversationIdsByOrgIds(
    organizationIds: string[],
    trx?: Knex.Transaction,
  ): Promise<Map<string, string>> {
    if (organizationIds.length === 0) return new Map();
    const rows = await this.conn(trx)('conversations')
      .where('type', 'CHAT_ROOM')
      .whereIn('organization_id', organizationIds)
      .select('organization_id', 'id');
    return new Map(rows.map((r: { organization_id: string; id: string }) => [r.organization_id, r.id]));
  }

  async updateRules(organizationId: string, rules: string | null, trx?: Knex.Transaction): Promise<void> {
    await this.conn(trx)('chat_room_details')
      .where({ organization_id: organizationId })
      .update({ rules, updated_at: (trx ?? this.db).fn.now() });
  }

  async setPinnedMessage(
    organizationId: string,
    messageId: string | null,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await this.conn(trx)('chat_room_details')
      .where({ organization_id: organizationId })
      .update({ pinned_message_id: messageId, updated_at: (trx ?? this.db).fn.now() });
  }
}
