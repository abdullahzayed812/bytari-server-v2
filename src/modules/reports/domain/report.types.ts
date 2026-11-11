export const REPORT_TARGET_TYPES = [
  'MESSAGE',
  'ROOM',
  'USER',
  'ANIMAL_PUBLICATION',
  'ORGANIZATION',
  'ORGANIZATION_REVIEW',
  'CONTENT_COMMENT',
  /** An AI assistant answer (consultation / inquiry / support thread message, `source = 'AI'`). */
  'AI_MESSAGE',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  'INAPPROPRIATE_CONTENT',
  'MISLEADING_INFO',
  'HARASSMENT',
  'SPAM',
  'RULES_VIOLATION',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['PENDING', 'REVIEWED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ContentReport {
  id: string;
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin queue row: the report + a short snapshot of what was reported. */
export interface AdminContentReport extends ContentReport {
  target: {
    /** Short text of the reported item (message / listing note / name…); null when gone. */
    preview: string | null;
    /** Author / owner of the reported item, when it has one. */
    authorUserId: string | null;
    /** False when the reported item no longer exists (deleted since). */
    exists: boolean;
  };
}

export interface ContentReportRow {
  id: string;
  reporter_user_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SubmitReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string | null;
}

export interface ListReportsFilter {
  page: number;
  pageSize: number;
  status?: ReportStatus;
  targetType?: ReportTargetType;
}
