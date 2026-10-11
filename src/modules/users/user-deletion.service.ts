import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { EventBus } from '../../shared/events/index.js';
import type { ObjectStorage } from '../../infra/storage/index.js';
import { deleteReplacedObjects } from '../../shared/storage/replaced-objects.js';
import { AuditAction, AuditEntityType } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ActorContext } from './user.service.js';
import { DELETED_USER_ID } from './user.types.js';

export { DELETED_USER_ID };

/** Why `DELETE /admin/users/:id` refused — `details[0].rule` of a 409 `USER_DELETE_BLOCKED`. */
export type UserDeleteBlockRule = 'PROTECTED_ACCOUNT' | 'ADMIN_ACCOUNT' | 'OWNS_ORGANIZATIONS';

export interface UserDeletionResult {
  id: string;
  deleted: true;
  /** Rows re-attributed to the placeholder account, per table (only non-zero entries). */
  retained: Record<string, number>;
  /** User-authored rows removed explicitly before the cascade, per table. */
  removed: Record<string, number>;
}

/** Audit metadata keys that hold personal data of the deleted account. */
const PERSONAL_AUDIT_KEYS = [
  'email',
  'toEmail',
  'phone',
  'firstName',
  'lastName',
  'name',
  'fullName',
  'recipientName',
  'recipientPhone',
];

/**
 * Permanent deletion of one account (`DELETE /admin/users/:id`, `user.delete`).
 *
 * The `users` row is really deleted. The schema decides most of what follows:
 * ~46 CASCADE references (sessions, refresh tokens, device push tokens, roles,
 * memberships, follows, likes, bookmarks, carts, notifications, chats, the
 * user's own marketplace items…) disappear with it and ~72 SET NULL
 * references keep their row with the author link cleared (medical records,
 * vaccinations, reminders, audit actor, moderation decisions…). The ~14
 * RESTRICT references are handled here, explicitly, inside ONE transaction:
 *
 *  - BLOCKED: owners of organizations (they hold other people's data — the
 *    organization must be transferred or deleted first), ADMIN accounts and
 *    the placeholder itself (protected), and the caller's own account.
 *  - RETAINED, re-attributed to {@link DELETED_USER_ID}: pets (+ their ownership
 *    history, so clinic medical history survives — pets the user still owned
 *    are DEACTIVATED), store orders (accounting; recipient name/phone scrubbed),
 *    clinic appointments, syndicate announcements (the syndicate's content).
 *  - REMOVED (personal content): the user's lost/adoption/mating listings, job
 *    offers, job applications, course registrations, courses and syndicate
 *    submissions.
 *
 * Personal data inside earlier audit entries ABOUT this user is redacted; the
 * entries themselves (and a new `USER_DELETED` entry with only ids/counts) are
 * kept. Media (avatar, identity documents) is deleted from storage after commit.
 */
export class UserDeletionService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'user-deletion' });
  }

  async deleteUser(id: string, actor: ActorContext): Promise<UserDeletionResult> {
    if (actor.actorUserId && actor.actorUserId === id) {
      throw new ForbiddenError('You cannot delete your own account');
    }
    if (id === DELETED_USER_ID)
      this.blocked('PROTECTED_ACCOUNT', 'This system account cannot be deleted');

    const retained: Record<string, number> = {};
    const removed: Record<string, number> = {};
    const mediaKeys: string[] = [];

    await this.db.transaction(async (tx) => {
      const user = await tx<{ id: string; avatar_key: string | null }>('users')
        .where({ id })
        .forUpdate()
        .first('id', 'avatar_key');
      if (!user) throw new NotFoundError('User not found');

      const roles = (await tx('user_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .where('ur.user_id', id)
        .pluck('r.key')) as string[];
      if (roles.includes('ADMIN')) {
        this.blocked(
          'ADMIN_ACCOUNT',
          'Administrator accounts are protected — remove the ADMIN role first',
        );
      }

      const ownedOrgs = await tx<{ id: string; name: string; type: string; owner_user_id: string }>(
        'organizations',
      )
        .where({ owner_user_id: id })
        .select('id', 'name', 'type');
      if (ownedOrgs.length > 0) {
        this.blocked(
          'OWNS_ORGANIZATIONS',
          `The user owns ${ownedOrgs.length} organization(s) (${ownedOrgs
            .map((o) => `${o.name} [${o.type}]`)
            .join(', ')}) — transfer or delete them first`,
        );
      }

      await this.ensurePlaceholder(tx);

      // --- media to delete after commit ------------------------------------
      if (user.avatar_key) mediaKeys.push(user.avatar_key);
      const docKeys = (await tx('veterinarian_application_documents as d')
        .join('veterinarian_applications as a', 'a.id', 'd.application_id')
        .where('a.user_id', id)
        .pluck('d.storage_key')) as string[];
      mediaKeys.push(...docKeys);

      // --- RETAINED: re-attribute to the placeholder -------------------------
      const count = (table: string, n: number): void => {
        if (n > 0) retained[table] = (retained[table] ?? 0) + n;
      };
      // Pets the user still owns stay registered (clinic history is RESTRICT-
      // protected) but are deactivated — nobody can act as their owner now.
      const ownedAnimalIds = (await tx('animal_ownerships')
        .where({ owner_user_id: id })
        .whereNull('ended_at')
        .pluck('animal_id')) as string[];
      if (ownedAnimalIds.length > 0) {
        await tx('animals')
          .whereIn('id', ownedAnimalIds)
          .update({ status: 'DEACTIVATED', deactivated_at: tx.fn.now(), updated_at: tx.fn.now() });
      }
      count(
        'animal_ownerships',
        await tx('animal_ownerships')
          .where({ owner_user_id: id })
          .update({ owner_user_id: DELETED_USER_ID }),
      );
      count(
        'animals',
        await tx('animals').where({ created_by: id }).update({ created_by: DELETED_USER_ID }),
      );
      for (const table of ['pet_owner_store_orders', 'veterinarian_store_orders']) {
        count(
          table,
          await tx(table)
            .where({ user_id: id })
            .update({ user_id: DELETED_USER_ID, recipient_name: '—', recipient_phone: '—' }),
        );
      }
      count(
        'clinic_appointments',
        await tx('clinic_appointments')
          .where({ created_by_user_id: id })
          .update({ created_by_user_id: DELETED_USER_ID }),
      );
      // CASCADE in the schema, but these are the clinic's records too.
      count(
        'clinic_appointments',
        await tx('clinic_appointments')
          .where({ pet_owner_user_id: id })
          .update({ pet_owner_user_id: DELETED_USER_ID }),
      );
      count(
        'syndicate_announcements',
        await tx('syndicate_announcements')
          .where({ created_by_user_id: id })
          .update({ created_by_user_id: DELETED_USER_ID }),
      );

      // --- REMOVED: the user's own personal content -------------------------
      const drop = async (table: string, column: string): Promise<void> => {
        const n = await tx(table)
          .where({ [column]: id })
          .del();
        if (n > 0) removed[table] = n;
      };
      const submissionKeys = (await tx('syndicate_submissions')
        .where({ submitted_by_user_id: id })
        .pluck('attachment_keys')) as string[][];
      mediaKeys.push(...submissionKeys.flat());
      await drop('animal_publications', 'created_by_user_id');
      await drop('vet_job_applications', 'applicant_user_id');
      await drop('vet_course_registrations', 'registrant_user_id');
      await drop('vet_job_offers', 'posted_by_user_id');
      await drop('vet_courses', 'creator_user_id');
      await drop('syndicate_submissions', 'submitted_by_user_id');

      // --- audit history: keep the entries, drop the personal data ----------
      await tx.raw(
        `UPDATE audit_logs
            SET metadata = metadata - ?::text[]
          WHERE entity_id = ? AND jsonb_exists_any(metadata, ?::text[])`,
        [PERSONAL_AUDIT_KEYS, id, PERSONAL_AUDIT_KEYS],
      );

      // The row itself — CASCADE / SET NULL handle every other reference.
      await tx('users').where({ id }).del();

      await this.audit.record(
        {
          action: AuditAction.USER_DELETED,
          entityType: AuditEntityType.USER,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { roles, retained, removed, mediaObjects: mediaKeys.length },
          context: actor.context,
        },
        tx,
      );
    });

    // After commit only: storage I/O and externally observable events.
    await deleteReplacedObjects(this.storage, this.log, mediaKeys, [], { deletedUserId: id });
    this.events.publish('user.deleted', { userId: id });
    return { id, deleted: true, retained, removed };
  }

  private blocked(rule: UserDeleteBlockRule, message: string): never {
    throw new ConflictError(message, {
      code: ErrorCode.USER_DELETE_BLOCKED,
      details: [{ rule, message }],
    });
  }

  private async ensurePlaceholder(tx: Knex.Transaction): Promise<void> {
    await tx('users')
      .insert({
        id: DELETED_USER_ID,
        email: 'deleted-user@system.invalid',
        // Not a valid argon2 hash — `PasswordService.verify` can never succeed.
        password_hash: '!deleted-account',
        first_name: 'مستخدم',
        last_name: 'محذوف',
        status: 'DEACTIVATED',
      })
      .onConflict('id')
      .ignore();
  }
}
