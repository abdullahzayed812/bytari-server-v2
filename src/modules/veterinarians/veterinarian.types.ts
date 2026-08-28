export const VET_APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type VetApplicationStatus = (typeof VET_APPLICATION_STATUSES)[number];

export interface VeterinarianApplication {
  id: string;
  userId: string;
  status: VetApplicationStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VeterinarianApplicationRow {
  id: string;
  user_id: string;
  status: string;
  note: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PendingApplicationSummary extends VeterinarianApplication {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export function rowToApplication(row: VeterinarianApplicationRow): VeterinarianApplication {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status as VetApplicationStatus,
    note: row.note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionReason: row.decision_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
