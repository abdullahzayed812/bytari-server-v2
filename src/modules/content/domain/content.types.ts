import type { ContentFileKind, ContentSort, ContentStatus, ContentType } from './content.constants.js';

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
  /** Book-only; null for ARTICLE/MAGAZINE. */
  language: string | null;
  pageCount: number | null;
  publishYear: number | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
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

/** `null` average when a BOOK has no ratings yet; always present (0/null) for non-BOOK types. */
export interface ContentRatingAggregate {
  average: number | null;
  count: number;
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
  language: string | null;
  pageCount: number | null;
  publishYear: number | null;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  rating: ContentRatingAggregate;
  /** Present only when the request is authenticated as a specific viewer. */
  isBookmarked: boolean;
  isLiked: boolean;
  categories: Category[];
  files: AdminContentFileDTO[] | PublicContentFileDTO[];
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- comments ---------------------------------------------------

export interface ContentComment {
  id: string;
  contentId: string;
  userId: string;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentCommentRow {
  id: string;
  content_id: string;
  user_id: string;
  body: string;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContentCommentDTO {
  id: string;
  contentId: string;
  userId: string;
  authorName: { firstName: string; lastName: string };
  body: string;
  createdAt: string;
  updatedAt: string;
}

export function rowToContentComment(row: ContentCommentRow): ContentComment {
  return {
    id: row.id,
    contentId: row.content_id,
    userId: row.user_id,
    body: row.body,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// --- ratings ------------------------------------------------------

export interface ContentRating {
  id: string;
  contentId: string;
  userId: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRatingRow {
  id: string;
  content_id: string;
  user_id: string;
  rating: number;
  created_at: Date;
  updated_at: Date;
}

export function rowToContentRating(row: ContentRatingRow): ContentRating {
  return {
    id: row.id,
    contentId: row.content_id,
    userId: row.user_id,
    rating: row.rating,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
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
  language: string | null;
  page_count: number | null;
  publish_year: number | null;
  like_count: number;
  comment_count: number;
  view_count: number;
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
    language: row.language,
    pageCount: row.page_count,
    publishYear: row.publish_year,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    viewCount: row.view_count,
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
  sort?: ContentSort;
  /** Only content the given viewer has bookmarked (requires `viewerId`). */
  bookmarkedOnly?: boolean;
  /** The authenticated caller, if any — powers `bookmarkedOnly` + per-item viewer state. */
  viewerId?: string;
}
