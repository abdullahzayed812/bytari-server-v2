export interface HomeAd {
  id: string;
  title: string;
  subtitle: string | null;
  imageStorageKey: string | null;
  imageStorageProvider: string | null;
  sortOrder: number;
  isActive: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Public/admin view — `imageUrl` is server-resolved, the storage key never leaves the server. */
export interface HomeAdDTO {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HomeAdRow {
  id: string;
  title: string;
  subtitle: string | null;
  image_storage_key: string | null;
  image_storage_provider: string | null;
  sort_order: number;
  is_active: boolean;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToHomeAd(row: HomeAdRow): HomeAd {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    imageStorageKey: row.image_storage_key,
    imageStorageProvider: row.image_storage_provider,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListHomeAdsFilter {
  page: number;
  pageSize: number;
  includeDeleted?: boolean;
}
