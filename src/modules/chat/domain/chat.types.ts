import type {
  ConversationSide,
  ConversationStatus,
  ConversationSubjectType,
  ConversationType,
  MessageType,
  ParticipantRole,
} from './chat.constants.js';

// --- internal aggregates --------------------------------------------

export interface Conversation {
  id: string;
  type: ConversationType;
  /** `null` for a PET_OWNER_VETERINARIAN marketplace deal. */
  organizationId: string | null;
  petOwnerUserId: string | null;
  memberUserId: string | null;
  /** Set for PET_OWNER_VETERINARIAN only. */
  veterinarianUserId: string | null;
  /** Pinned vet-service engagement (PET_OWNER_VETERINARIAN only). */
  subjectType: ConversationSubjectType | null;
  subjectId: string | null;
  /** Job lifecycle (`OPEN` for org conversations, always). */
  status: ConversationStatus;
  createdByUserId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  conversationId: string;
  userId: string;
  role: ParticipantRole;
  lastReadMessageId: string | null;
  joinedAt: string;
  leftAt: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  type: MessageType;
  deletedAt: string | null;
  createdAt: string;
}

// --- API DTOs ------------------------------------------------------

export interface ConversationDTO {
  id: string;
  type: ConversationType;
  organizationId: string | null;
  /** The individual counterpart on the "personal" side (pet owner / farm member / vet). */
  counterpartUserId: string | null;
  /** The caller's resolved side for this conversation. */
  viewerSide: ConversationSide;
  /** Pinned vet-service engagement (PET_OWNER_VETERINARIAN only). */
  subjectType: ConversationSubjectType | null;
  subjectId: string | null;
  status: ConversationStatus;
  lastMessageAt: string | null;
  /** `null` when read state is not tracked for the caller (dynamic clinic side). */
  unreadCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  senderUserId: string;
  /** `null` for a soft-deleted message; `deletedAt` is then set. */
  body: string | null;
  type: MessageType;
  deletedAt: string | null;
  createdAt: string;
}

// --- rows --------------------------------------------------------

export interface ConversationRow {
  id: string;
  type: string;
  organization_id: string | null;
  pet_owner_user_id: string | null;
  member_user_id: string | null;
  veterinarian_user_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  status: string;
  created_by_user_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  type: string;
  deleted_at: Date | null;
  created_at: Date;
}

export interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  role: string;
  last_read_message_id: string | null;
  joined_at: Date;
  left_at: Date | null;
}

export function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    type: row.type as ConversationType,
    organizationId: row.organization_id,
    petOwnerUserId: row.pet_owner_user_id,
    memberUserId: row.member_user_id,
    veterinarianUserId: row.veterinarian_user_id,
    subjectType: (row.subject_type as ConversationSubjectType | null) ?? null,
    subjectId: row.subject_id,
    status: (row.status as ConversationStatus | undefined) ?? 'OPEN',
    createdByUserId: row.created_by_user_id,
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    type: row.type as MessageType,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function toMessageDTO(m: Message): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderUserId: m.senderUserId,
    body: m.deletedAt ? null : m.body,
    type: m.type,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
  };
}

export interface ListConversationsFilter {
  page: number;
  pageSize: number;
  organizationId?: string;
}
