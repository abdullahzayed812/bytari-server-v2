import type { MessageSource, ThreadKind, ThreadStatus } from './thread.constants.js';

// --- internal aggregates -------------------------------------------

export interface SupportThread {
  id: string;
  createdByUserId: string;
  animalId: string | null;
  status: ThreadStatus;
  senderBlockedAt: string | null;
  aiResponded: boolean;
  lastMessageAt: string | null;
  closedAt: string | null;
  closedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  senderUserId: string | null;
  source: MessageSource;
  body: string;
  deletedAt: string | null;
  createdAt: string;
}

// --- API DTOs ----------------------------------------------------

export interface ThreadDTO {
  id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  createdByUserId: string;
  animalId: string | null;
  senderBlocked: boolean;
  aiResponded: boolean;
  lastMessageAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadMessageDTO {
  id: string;
  threadId: string;
  senderUserId: string | null;
  source: MessageSource;
  /** `null` for a soft-deleted message. */
  body: string | null;
  deletedAt: string | null;
  createdAt: string;
}

// --- rows ------------------------------------------------------

export interface ThreadRow {
  id: string;
  created_by_user_id: string;
  animal_id?: string | null;
  status: string;
  sender_blocked_at: Date | null;
  ai_responded: boolean;
  last_message_at: Date | null;
  closed_at: Date | null;
  closed_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ThreadMessageRow {
  id: string;
  thread_id: string;
  sender_user_id: string | null;
  source: string;
  body: string;
  deleted_at: Date | null;
  created_at: Date;
}

export function rowToThread(row: ThreadRow): SupportThread {
  return {
    id: row.id,
    createdByUserId: row.created_by_user_id,
    animalId: row.animal_id ?? null,
    status: row.status as ThreadStatus,
    senderBlockedAt: row.sender_blocked_at ? row.sender_blocked_at.toISOString() : null,
    aiResponded: row.ai_responded,
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    closedAt: row.closed_at ? row.closed_at.toISOString() : null,
    closedByUserId: row.closed_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToThreadMessage(row: ThreadMessageRow): ThreadMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderUserId: row.sender_user_id,
    source: row.source as MessageSource,
    body: row.body,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export function toThreadDTO(kind: ThreadKind, t: SupportThread): ThreadDTO {
  return {
    id: t.id,
    kind,
    status: t.status,
    createdByUserId: t.createdByUserId,
    animalId: t.animalId,
    senderBlocked: t.senderBlockedAt !== null,
    aiResponded: t.aiResponded,
    lastMessageAt: t.lastMessageAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function toThreadMessageDTO(m: ThreadMessage): ThreadMessageDTO {
  return {
    id: m.id,
    threadId: m.threadId,
    senderUserId: m.senderUserId,
    source: m.source,
    body: m.deletedAt ? null : m.body,
    deletedAt: m.deletedAt,
    createdAt: m.createdAt,
  };
}

export interface ListThreadsFilter {
  page: number;
  pageSize: number;
  status?: ThreadStatus;
  createdByUserId?: string;
}
