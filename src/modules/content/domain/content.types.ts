import type { ContentFileKind, ContentStatus, ContentType } from './content.constants.js';

// --- internal aggregates -----------------------------------------

export interface Content {
  id: string;
  type: ContentType;
  title: string;
  description: string | null;
  body: string | null;
  authorName: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentFile {
  id: string;
  contentId: string;
  kind: ContentFileKind;
  storageKey: string;
  storageProvider: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- API DTOs ---------------------------------------------------

/** File view for content managers — includes the storage key. */
export interface AdminContentFileDTO {
  id: string;
  contentId: string;
  kind: ContentFileKind;
  storageKey: string;
  storageProvider: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  uploadedByUserId: string | null;
  createdAt: string;
}

/** File view for normal users — NO storage key; download via the `/download` route. */
export interface PublicContentFileDTO {
  id: string;
  kind: ContentFileKind;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ContentDTO {
  id: string;
  type: ContentType;
  title: string;
  description: string | null;
  body: string | null;
  authorName: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  /**
   * Resolved URL of the item's COVER file (public R2 URL or a signed fallback),
   * or `null` when there is no cover. Same convention as `content_tips`
   * `coverImageUrl` — the client never builds it.
   */
  coverImageUrl: string | null;
  categories: Category[];
  files: AdminContentFileDTO[] | PublicContentFileDTO[];
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- rows -----------------------------------------------------

export interface ContentRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  body: string | null;
  author_name: string | null;
  status: string;
  published_at: Date | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContentFileRow {
  id: string;
  content_id: string;
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

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToContent(row: ContentRow): Content {
  return {
    id: row.id,
    type: row.type as ContentType,
    title: row.title,
    description: row.description,
    body: row.body,
    authorName: row.author_name,
    status: row.status as ContentStatus,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToContentFile(row: ContentFileRow): ContentFile {
  return {
    id: row.id,
    contentId: row.content_id,
    kind: row.kind as ContentFileKind,
    storageKey: row.storage_key,
    storageProvider: row.storage_provider,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksum: row.checksum,
    uploadedByUserId: row.uploaded_by_user_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toAdminFileDTO(f: ContentFile): AdminContentFileDTO {
  return {
    id: f.id,
    contentId: f.contentId,
    kind: f.kind,
    storageKey: f.storageKey,
    storageProvider: f.storageProvider,
    originalFilename: f.originalFilename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    checksum: f.checksum,
    uploadedByUserId: f.uploadedByUserId,
    createdAt: f.createdAt,
  };
}

export function toPublicFileDTO(f: ContentFile): PublicContentFileDTO {
  return {
    id: f.id,
    kind: f.kind,
    originalFilename: f.originalFilename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
  };
}

export interface ListContentFilter {
  page: number;
  pageSize: number;
  type?: ContentType;
  status?: ContentStatus;
  categoryId?: string;
  search?: string;
  includeDeleted?: boolean;
}
