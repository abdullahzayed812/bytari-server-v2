import type { TipPriority, TipStatus } from './tip.constants.js';

// --- internal aggregate ---------------------------------------------

export interface Tip {
  id: string;
  categoryId: string | null;
  title: string;
  summary: string | null;
  readMinutes: number | null;
  priority: TipPriority;
  isTipOfDay: boolean;
  coverImageStorageKey: string | null;
  coverImageStorageProvider: string | null;
  bodyIntro: string | null;
  keyPoints: string[];
  warningPoints: string[];
  vetAdvice: string | null;
  status: TipStatus;
  publishedAt: string | null;
  helpfulCount: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TipCategoryRef {
  id: string;
  slug: string;
  name: string;
}

/** Viewer-relative flags resolved per request. */
export interface TipViewerState {
  isBookmarked: boolean;
  isHelpful: boolean;
}

/** List-card projection (public). */
export interface TipListItemDTO {
  id: string;
  title: string;
  summary: string | null;
  readMinutes: number | null;
  priority: TipPriority;
  isTipOfDay: boolean;
  category: TipCategoryRef | null;
  coverImageUrl: string | null;
  helpfulCount: number;
  isBookmarked: boolean;
  isHelpful: boolean;
  publishedAt: string | null;
}

/** Full detail (public). */
export interface TipDTO extends TipListItemDTO {
  bodyIntro: string | null;
  keyPoints: string[];
  warningPoints: string[];
  vetAdvice: string | null;
  updatedAt: string;
}

/** Admin detail — adds lifecycle/audit fields and the raw status. */
export interface AdminTipDTO extends TipDTO {
  status: TipStatus;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
}

// --- row ---------------------------------------------------------

export interface TipRow {
  id: string;
  category_id: string | null;
  title: string;
  summary: string | null;
  read_minutes: number | null;
  priority: string;
  is_tip_of_day: boolean;
  cover_image_storage_key: string | null;
  cover_image_storage_provider: string | null;
  body_intro: string | null;
  key_points: string[] | string;
  warning_points: string[] | string;
  vet_advice: string | null;
  status: string;
  published_at: Date | null;
  helpful_count: number;
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

export function rowToTip(row: TipRow): Tip {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    summary: row.summary,
    readMinutes: row.read_minutes,
    priority: row.priority as TipPriority,
    isTipOfDay: row.is_tip_of_day,
    coverImageStorageKey: row.cover_image_storage_key,
    coverImageStorageProvider: row.cover_image_storage_provider,
    bodyIntro: row.body_intro,
    keyPoints: asStringArray(row.key_points),
    warningPoints: asStringArray(row.warning_points),
    vetAdvice: row.vet_advice,
    status: row.status as TipStatus,
    publishedAt: row.published_at ? row.published_at.toISOString() : null,
    helpfulCount: row.helpful_count,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// --- filters ---------------------------------------------------

export interface ListTipsFilter {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  priority?: TipPriority;
  /** Public: restrict to the caller's bookmarked tips. */
  bookmarkedByUserId?: string;
}

export interface ListAdminTipsFilter {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  priority?: TipPriority;
  status?: TipStatus;
  includeDeleted?: boolean;
}
