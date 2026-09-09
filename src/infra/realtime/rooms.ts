/**
 * Canonical room-name builders. All room membership flows through these so the
 * naming stays consistent across modules and the authorizer can pattern-match.
 */
export const rooms = {
  /** Per-user room. Every authenticated socket auto-joins its own. */
  user: (userId: string): string => `user:${userId}`,
  /** All members of an organisation (clinic, farm, store, …). */
  org: (orgId: string): string => `org:${orgId}`,
  /** A single chat conversation thread. */
  conversation: (conversationId: string): string => `conversation:${conversationId}`,
  /** A consultation thread. */
  consultation: (consultationId: string): string => `consultation:${consultationId}`,
  /** An inquiry thread. */
  inquiry: (inquiryId: string): string => `inquiry:${inquiryId}`,
  /** A support-message thread ("تواصل معنا"). */
  support: (supportId: string): string => `support:${supportId}`,
  /** The single content-management activity feed (Admin / Content Supervisor). */
  contentFeed: (): string => `content:feed`,
} as const;

export type RoomKind = keyof typeof rooms;

/** Split `"kind:id"` → `{ kind, id }`, or `null` if it is not a namespaced room. */
export function parseRoom(room: string): { kind: string; id: string } | null {
  const idx = room.indexOf(':');
  if (idx <= 0 || idx === room.length - 1) return null;
  return { kind: room.slice(0, idx), id: room.slice(idx + 1) };
}
