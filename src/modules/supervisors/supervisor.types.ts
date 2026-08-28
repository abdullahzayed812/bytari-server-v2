import type { SupervisorDomain } from '../rbac/rbac.constants.js';

export const SUPERVISOR_ASSIGNMENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SupervisorAssignmentStatus = (typeof SUPERVISOR_ASSIGNMENT_STATUSES)[number];

export interface SupervisorAssignment {
  id: string;
  userId: string;
  domain: SupervisorDomain;
  status: SupervisorAssignmentStatus;
  assignedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupervisorAssignmentSummary extends SupervisorAssignment {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export interface SupervisorAssignmentRow {
  id: string;
  user_id: string;
  domain: string;
  status: string;
  assigned_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListSupervisorFilter {
  page: number;
  pageSize: number;
  domain?: SupervisorDomain;
  userId?: string;
  status?: SupervisorAssignmentStatus;
}

export function rowToAssignment(row: SupervisorAssignmentRow): SupervisorAssignment {
  return {
    id: row.id,
    userId: row.user_id,
    domain: row.domain as SupervisorDomain,
    status: row.status as SupervisorAssignmentStatus,
    assignedBy: row.assigned_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
