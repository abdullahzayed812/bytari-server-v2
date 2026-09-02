import type { AdPlacement, AdType } from './advertisement.constants.js';

// --- domain models --------------------------------------------------

export interface AdSlide {
  id: string;
  campaignId: string;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  imageStorageKey: string | null;
  imageStorageProvider: string | null;
  sortOrder: number;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdCampaign {
  id: string;
  placement: AdPlacement;
  type: AdType;
  title: string;
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- DTOs (image key never leaves the server; `imageUrl` is resolved) ----

export interface AdSlideDTO {
  id: string;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  imageUrl: string | null;
  sortOrder: number;
}

export interface AdCampaignDTO {
  id: string;
  placement: AdPlacement;
  type: AdType;
  title: string;
  isActive: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  slides: AdSlideDTO[];
  createdAt: string;
  updatedAt: string;
}

/** Public projection — no lifecycle metadata, only what the app renders. */
export interface PublicAdCampaignDTO {
  id: string;
  placement: AdPlacement;
  type: AdType;
  title: string;
  slides: AdSlideDTO[];
}

// --- rows ---------------------------------------------------------

export interface AdCampaignRow {
  id: string;
  placement: string;
  type: string;
  title: string;
  is_active: boolean;
  sort_order: number;
  starts_at: Date | null;
  ends_at: Date | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AdSlideRow {
  id: string;
  campaign_id: string;
  title: string | null;
  subtitle: string | null;
  cta_label: string | null;
  cta_url: string | null;
  image_storage_key: string | null;
  image_storage_provider: string | null;
  sort_order: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToCampaign(row: AdCampaignRow): AdCampaign {
  return {
    id: row.id,
    placement: row.placement as AdPlacement,
    type: row.type as AdType,
    title: row.title,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    startsAt: row.starts_at ? row.starts_at.toISOString() : null,
    endsAt: row.ends_at ? row.ends_at.toISOString() : null,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function rowToSlide(row: AdSlideRow): AdSlide {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    subtitle: row.subtitle,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    imageStorageKey: row.image_storage_key,
    imageStorageProvider: row.image_storage_provider,
    sortOrder: row.sort_order,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// --- filters ----------------------------------------------------

export interface ListCampaignsFilter {
  page: number;
  pageSize: number;
  includeDeleted?: boolean;
  placement?: AdPlacement;
  type?: AdType;
}
