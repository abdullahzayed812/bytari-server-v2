import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/app-error.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../audit/audit.types.js';
import type { AuditService } from '../audit/audit.service.js';
import type { PermissionRepository } from './permission.repository.js';
import type { RoleRepository } from './role.repository.js';
import { ADMIN_ROLE_KEY } from './rbac.constants.js';
import type { Permission, Role, RoleWithPermissions } from './rbac.types.js';

export interface RbacActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Management of global roles, permissions and their relationships.
 * The read-side permission *evaluation* lives in `AuthorizationService`.
 */
export class RbacService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly roles: RoleRepository,
    private readonly permissions: PermissionRepository,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'rbac-service' });
  }

  async listRolesWithPermissions(): Promise<RoleWithPermissions[]> {
    const roles = await this.roles.listRoles();
    return Promise.all(
      roles.map(async (role) => ({
        ...role,
        permissions: await this.roles.getPermissionKeysForRole(role.id),
      })),
    );
  }

  async getRoleWithPermissions(key: string): Promise<RoleWithPermissions> {
    const role = await this.roles.findByKey(key);
    if (!role) throw new NotFoundError('Role not found');
    return { ...role, permissions: await this.roles.getPermissionKeysForRole(role.id) };
  }

  listPermissions(): Promise<Permission[]> {
    return this.permissions.list();
  }

  getRoleKeysForUser(userId: string): Promise<string[]> {
    return this.roles.getRoleKeysForUser(userId);
  }

  getRolesForUser(userId: string): Promise<Role[]> {
    return this.roles.getRolesForUser(userId);
  }

  // --- user ↔ role -------------------------------------------------------

  async assignRoleToUser(userId: string, roleKey: string, actor: RbacActor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const role = await this.roles.findByKey(roleKey, tx);
      if (!role) throw new NotFoundError('Role not found');

      const inserted = await this.roles.assignRole(userId, role.id, actor.actorUserId, tx);
      if (!inserted) throw new ConflictError('User already has this role');

      await this.audit.record(
        {
          action: AuditAction.ROLE_ASSIGNED,
          entityType: AuditEntityType.USER_ROLE,
          entityId: userId,
          actorUserId: actor.actorUserId,
          metadata: { roleKey: role.key },
          context: actor.context,
        },
        tx,
      );
    });
  }

  async removeRoleFromUser(userId: string, roleKey: string, actor: RbacActor): Promise<void> {
    if (roleKey === ADMIN_ROLE_KEY && userId === actor.actorUserId) {
      throw new ForbiddenError('You cannot remove your own administrator role');
    }

    await this.db.transaction(async (tx) => {
      const role = await this.roles.findByKey(roleKey, tx);
      if (!role) throw new NotFoundError('Role not found');

      if (!(await this.roles.userHasRoleKey(userId, roleKey, tx))) {
        throw new NotFoundError('User does not have this role');
      }

      if (roleKey === ADMIN_ROLE_KEY) {
        const admins = await this.roles.countUsersWithRoleKey(ADMIN_ROLE_KEY, {}, tx);
        if (admins <= 1) throw new ConflictError('Cannot remove the last administrator');
      }

      await this.roles.removeRole(userId, role.id, tx);
      await this.audit.record(
        {
          action: AuditAction.ROLE_REMOVED,
          entityType: AuditEntityType.USER_ROLE,
          entityId: userId,
          actorUserId: actor.actorUserId,
          metadata: { roleKey: role.key },
          context: actor.context,
        },
        tx,
      );
    });
  }

  // --- role ↔ permission ----------------------------------------------

  async addPermissionToRole(
    roleKey: string,
    permissionKey: string,
    actor: RbacActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const role = await this.roles.findByKey(roleKey, tx);
      if (!role) throw new NotFoundError('Role not found');
      const permission = await this.permissions.findByKey(permissionKey, tx);
      if (!permission) throw new NotFoundError('Permission not found');
      if (role.key === ADMIN_ROLE_KEY) {
        throw new BadRequestError(
          'The ADMIN role has full access via the authorization override; managing its permission rows has no effect',
        );
      }

      const inserted = await this.roles.addPermissionToRole(role.id, permission.id, tx);
      if (!inserted) throw new ConflictError('Role already has this permission');

      await this.audit.record(
        {
          action: AuditAction.PERMISSION_ASSIGNED,
          entityType: AuditEntityType.ROLE_PERMISSION,
          entityId: role.id,
          actorUserId: actor.actorUserId,
          metadata: { roleKey: role.key, permissionKey: permission.key },
          context: actor.context,
        },
        tx,
      );
    });
  }

  async removePermissionFromRole(
    roleKey: string,
    permissionKey: string,
    actor: RbacActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const role = await this.roles.findByKey(roleKey, tx);
      if (!role) throw new NotFoundError('Role not found');
      const permission = await this.permissions.findByKey(permissionKey, tx);
      if (!permission) throw new NotFoundError('Permission not found');

      const removed = await this.roles.removePermissionFromRole(role.id, permission.id, tx);
      if (removed === 0) throw new NotFoundError('Role does not have this permission');

      await this.audit.record(
        {
          action: AuditAction.PERMISSION_REMOVED,
          entityType: AuditEntityType.ROLE_PERMISSION,
          entityId: role.id,
          actorUserId: actor.actorUserId,
          metadata: { roleKey: role.key, permissionKey: permission.key },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
