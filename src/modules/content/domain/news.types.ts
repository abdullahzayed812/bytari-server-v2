import type { NewsStatus, NewsTag } from './news.constants.js';

// --- internal aggregate ---------------------------------------------

export interface News {
  id: string;
  categoryId: string | null;
  title: string;
  summary: string | null;
  source: string | null;
  isFeatured: boolean;
  tag: NewsTag;
  coverImageStorageKey: string | null;
  coverImageStorageProvider: string | null;
  body: string | null;
  reasonPoints: string[];
  advicePoints: string[];
  alertNote: string | null;
  galleryKeys: string[];
  status: NewsStatus;
  publishedAt: string | null;
  bookmarkCount: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewsCategoryRef {
  id: string;
  slug: string;
  name: string;
}

/** List-card projection (public). */
export interface NewsListItemDTO {
  id: string;
  title: string;
  summary: string | null;
  source: string | null;
  isFeatured: boolean;
  tag: NewsTag;
  category: NewsCategoryRef | null;
  coverImageUrl: string | null;
  bookmarkCount: number;
  isBookmarked: boolean;
  publishedAt: string | null;
}

/** Full detail (public). */
export interface NewsDTO extends NewsListItemDTO {
  body: string | null;
  reasonPoints: string[];
  advicePoints: string[];
  alertNote: string | null;
  galleryUrls: string[];
  updatedAt: string;
}

/** Admin detail — adds lifecycle/audit fields and the raw status. */
export interface AdminNewsDTO extends NewsDTO {
  status: NewsStatus;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
}

// --- row ---------------------------------------------------------

export interface NewsRow {
  id: string;
  category_id: string | null;
  title: string;
  summary: string | null;
  source: string | null;
  is_featured: boolean;
  tag: string;
  cover_image_storage_key: string | null;
  cover_image_storage_provider: string | null;
  body: string | null;
  reason_points: string[] | string;
  advice_points: string[] | string;
  alert_note: string | null;
  gallery_keys: string[] | null;
  status: string;
  published_at: Date | null;
  bookmark_count: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function asStringArray(v: string[] | string | null): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function rowToNews(row: NewsRow): News {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    summary: row.summary,
    source: row.source,
    isFeatured: row.is_featured,
    tag: row.tag as NewsTag,
    coverImageStorageKey: row.cover_image_storage_key,
    coverImageStorageProvider: row.cover_image_storage_provider,
    body: row.body,
    reasonPoints: asStringArray(row.reason_points),
    advicePoints: asStringArray(row.advice_points),
    alertNote: row.alert_note,
    galleryKeys: row.gallery_keys ?? [],
    status: row.status as NewsStatus,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    bookmarkCount: row.bookmark_count,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// --- filters ---------------------------------------------------

export interface ListNewsFilter {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  tag?: NewsTag;
  featured?: boolean;
  /** Public: restrict to the caller's bookmarked news. */
  bookmarkedByUserId?: string;
}

export interface ListAdminNewsFilter {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  tag?: NewsTag;
  status?: NewsStatus;
  includeDeleted?: boolean;
}
