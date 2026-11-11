import type { Knex } from 'knex';
import { BadRequestError, NotFoundError } from '../../shared/errors/app-error.js';
import { DELETED_USER_ID } from './user.types.js';

export interface BlockedUserDTO {
  userId: string;
  firstName: string;
  lastName: string;
  blockedAt: string;
}

/**
 * User-to-user blocking (Google Play UGC policy). A block is one-directional
 * in storage but symmetric in effect for direct chats: neither side can send
 * a message into a non-room conversation shared with the other
 * (`ChatService.sendMessage` → 403 `USER_BLOCKED`). In Global Chat rooms the
 * blocker's client hides the blocked user's messages.
 */
export class UserBlockService {
  constructor(private readonly db: Knex) {}

  async list(blockerUserId: string): Promise<BlockedUserDTO[]> {
    const rows = await this.db('user_blocks as b')
      .join('users as u', 'u.id', 'b.blocked_user_id')
      .where('b.blocker_user_id', blockerUserId)
      .orderBy('b.created_at', 'desc')
      .select('u.id', 'u.first_name', 'u.last_name', 'b.created_at');
    return rows.map(
      (r: { id: string; first_name: string; last_name: string; created_at: Date }) => ({
        userId: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        blockedAt: r.created_at.toISOString(),
      }),
    );
  }

  async block(blockerUserId: string, blockedUserId: string): Promise<void> {
    if (blockerUserId === blockedUserId) throw new BadRequestError('You cannot block yourself');
    if (blockedUserId === DELETED_USER_ID) throw new NotFoundError('User not found');
    const target = await this.db<{ id: string }>('users').where({ id: blockedUserId }).first('id');
    if (!target) throw new NotFoundError('User not found');
    await this.db('user_blocks')
      .insert({ blocker_user_id: blockerUserId, blocked_user_id: blockedUserId })
      .onConflict(['blocker_user_id', 'blocked_user_id'])
      .ignore();
  }

  async unblock(blockerUserId: string, blockedUserId: string): Promise<void> {
    await this.db('user_blocks')
      .where({ blocker_user_id: blockerUserId, blocked_user_id: blockedUserId })
      .del();
  }
}

/** True when `userId` blocked any of `others`, or any of `others` blocked `userId`. */
export async function isBlockedWithAny(
  db: Knex | Knex.Transaction,
  userId: string,
  others: string[],
): Promise<boolean> {
  if (others.length === 0) return false;
  const row = await db<{ blocker_user_id: string; blocked_user_id: string }>('user_blocks')
    .where(function blockedEitherWay(this: Knex.QueryBuilder) {
      void this.where('blocker_user_id', userId)
        .whereIn('blocked_user_id', others)
        .orWhere(function reverse(this: Knex.QueryBuilder) {
          void this.where('blocked_user_id', userId).whereIn('blocker_user_id', others);
        });
    })
    .first('blocker_user_id');
  return Boolean(row);
}
