export const VET_APPLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type VetApplicationStatus = (typeof VET_APPLICATION_STATUSES)[number];

export const VET_APPLICATION_SUB_TYPES = ['VETERINARIAN', 'STUDENT'] as const;
export type VetApplicationSubType = (typeof VET_APPLICATION_SUB_TYPES)[number];

export const VET_APPLICATION_DOCUMENT_KINDS = [
  'LICENSE_OR_ID',
  'ADDITIONAL_ID',
  'STUDENT_ID_FRONT',
  'STUDENT_ID_BACK',
] as const;
export type VetApplicationDocumentKind = (typeof VET_APPLICATION_DOCUMENT_KINDS)[number];

export interface VeterinarianApplication {
  id: string;
  userId: string;
  status: VetApplicationStatus;
  subType: VetApplicationSubType;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Applicant-facing document metadata — never includes the storage key. */
  documents: VeterinarianApplicationDocument[];
}

export interface VeterinarianApplicationRow {
  id: string;
  user_id: string;
  status: string;
  sub_type: string;
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
  /** Admin-only view of documents, including a short-lived signed download URL. */
  documents: AdminVeterinarianApplicationDocument[];
}

export function rowToApplication(row: VeterinarianApplicationRow): Omit<
  VeterinarianApplication,
  'documents'
> {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status as VetApplicationStatus,
    subType: row.sub_type as VetApplicationSubType,
    note: row.note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionReason: row.decision_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// --- documents -----------------------------------------------------

export interface VeterinarianApplicationDocumentRow {
  id: string;
  application_id: string;
  kind: string;
  storage_key: string;
  storage_provider: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string | number;
  checksum: string | null;
  uploaded_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Full internal record, including the storage key. Never returned to the applicant. */
export interface VeterinarianApplicationDocumentRecord {
  id: string;
  applicationId: string;
  kind: VetApplicationDocumentKind;
  storageKey: string;
  storageProvider: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedByUserId: string | null;
  createdAt: string;
}

/** Applicant-facing DTO — deliberately omits `storageKey` / `storageProvider`. */
export interface VeterinarianApplicationDocument {
  kind: VetApplicationDocumentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Admin-facing DTO — adds a short-lived signed download URL, never the raw key. */
export interface AdminVeterinarianApplicationDocument extends VeterinarianApplicationDocument {
  downloadUrl: string;
}

export function rowToApplicationDocument(
  row: VeterinarianApplicationDocumentRow,
): VeterinarianApplicationDocumentRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    kind: row.kind as VetApplicationDocumentKind,
    storageKey: row.storage_key,
    storageProvider: row.storage_provider,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

export function toApplicantDocumentDTO(
  doc: VeterinarianApplicationDocumentRecord,
): VeterinarianApplicationDocument {
  return {
    kind: doc.kind,
    filename: doc.originalFilename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    createdAt: doc.createdAt,
  };
}
