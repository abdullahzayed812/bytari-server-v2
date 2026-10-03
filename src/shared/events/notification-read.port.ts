/**
 * "Reading the thing clears its alerts": a module that has its own read state
 * (a chat conversation, a consultation / inquiry / support thread) calls this
 * when the user reads it, so the matching unread notifications in the bell are
 * marked read too — otherwise the badge keeps counting messages the user has
 * already seen. Implemented in the container over `NotificationRepository`
 * (emits `notification.read` per row), so modules never import notifications.
 */
export interface NotificationReadPort {
  markReadForEntity(userId: string, entityType: string, entityId: string): Promise<void>;
  /**
   * Unread notifications per entity id — the read state of a side that has no
   * per-member pointer of its own (a clinic / office conversation's org side:
   * every member gets a CHAT_MESSAGE_RECEIVED per message, cleared on read).
   */
  countUnreadForEntities(
    userId: string,
    entityType: string,
    entityIds: string[],
  ): Promise<Map<string, number>>;
}
