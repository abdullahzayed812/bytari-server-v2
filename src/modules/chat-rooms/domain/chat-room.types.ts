/**
 * Global Chat — public discussion rooms. A room IS an `organizations` row
 * (`type = 'CHAT_ROOM'`) plus a `chat_room_details` extension row and a
 * single backing `conversations` row (type `CHAT_ROOM`) for its discussion —
 * see the module header comment in `chat-room.service.ts` for the full reuse
 * rationale. No bespoke room/member tables.
 */

export interface CreateChatRoomInput {
  name: string;
  description?: string | null;
  rules?: string | null;
}

export interface UpdateChatRoomRulesInput {
  rules: string | null;
}

/** List/browse card — "الدردشات" screen. */
export interface ChatRoomSummaryDTO {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  memberCount: number;
  /** `0` when the viewer hasn't joined. */
  unreadCount: number;
  isJoined: boolean;
  status: string;
  createdAt: string;
}

/** Room details screen — "معلومات الغرفة". */
export interface ChatRoomDetailDTO extends ChatRoomSummaryDTO {
  rules: string | null;
  conversationId: string;
  /** The viewer's own join date, `null` when not a member. */
  joinedAt: string | null;
  /** The viewer's own mute preference, `false` when not a member. */
  notificationsMuted: boolean;
  pinnedMessage: { id: string; body: string; senderUserId: string; createdAt: string } | null;
}

export interface ListChatRoomsFilter {
  page: number;
  pageSize: number;
  search?: string;
}

/**
 * Lean member roster — lets a room's thread screen show "who said what"
 * (`senderUserId` → display name) without the generic
 * `GET /organizations/:id/members` endpoint's `member.read` gate, which a
 * plain room member (org role STAFF) does not hold. Any ACTIVE member of the
 * room may list it — self-service, same trust boundary as join/leave.
 */
export interface ChatRoomMemberDTO {
  userId: string;
  firstName: string;
  lastName: string;
  roleKey: string;
}
