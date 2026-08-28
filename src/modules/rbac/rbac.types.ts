export interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleWithPermissions extends Role {
  permissions: string[];
}

export interface Permission {
  id: string;
  key: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PermissionRow {
  id: string;
  key: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToRole(row: RoleRow): Role {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToPermission(row: PermissionRow): Permission {
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
