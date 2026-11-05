import type { MarketModerationStatus } from './market-moderation.js';
import type { ChickType, HatcheryOfferStatus } from './hatchery-offer.constants.js';

export interface HatcheryOffer {
  id: string;
  traderUserId: string;
  chickType: ChickType;
  breed: string | null;
  chickAgeDays: number;
  /** Production / listing day — `YYYY-MM-DD` (business date, no time). */
  productionDate: string;
  quantity: number | null;
  /** Decimal string (PostgreSQL numeric). Never a JS float. */
  pricePerChick: string | null;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  notes: string | null;
  galleryKeys: string[];
  status: HatcheryOfferStatus;
  /** PENDING until a moderator approves; only APPROVED offers are public. */
  moderationStatus: MarketModerationStatus;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** API DTO — adds resolved image URLs, never the raw storage keys. */
export interface HatcheryOfferDTO extends Omit<HatcheryOffer, 'galleryKeys'> {
  imageUrls: string[];
}

export interface HatcheryOfferRow {
  id: string;
  trader_user_id: string;
  chick_type: string;
  breed: string | null;
  chick_age_days: number;
  production_date: string | Date;
  quantity: number | null;
  price_per_chick: string | null;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  notes: string | null;
  gallery_keys: string[] | null;
  status: string;
  moderation_status: string;
  rejection_reason: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** `date` columns come back as a JS Date (local midnight) or a string depending on the pg type parser. */
function toDateOnly(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function rowToHatcheryOffer(row: HatcheryOfferRow): HatcheryOffer {
  return {
    id: row.id,
    traderUserId: row.trader_user_id,
    chickType: row.chick_type as ChickType,
    breed: row.breed,
    chickAgeDays: Number(row.chick_age_days),
    productionDate: toDateOnly(row.production_date),
    quantity: row.quantity == null ? null : Number(row.quantity),
    pricePerChick: row.price_per_chick,
    governorate: row.governorate,
    district: row.district,
    phone: row.phone,
    whatsapp: row.whatsapp,
    notes: row.notes,
    galleryKeys: row.gallery_keys ?? [],
    status: row.status as HatcheryOfferStatus,
    moderationStatus: row.moderation_status as MarketModerationStatus,
    rejectionReason: row.rejection_reason,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toHatcheryOfferDTO(offer: HatcheryOffer, imageUrls: string[]): HatcheryOfferDTO {
  const { galleryKeys: _galleryKeys, ...rest } = offer;
  return { ...rest, imageUrls };
}

export interface CreateHatcheryOfferInput {
  chickType: ChickType;
  breed?: string | null;
  chickAgeDays: number;
  productionDate: string;
  quantity?: number | null;
  pricePerChick?: string | null;
  governorate: string;
  district?: string | null;
  phone: string;
  whatsapp?: string | null;
  notes?: string | null;
  galleryKeys?: string[];
}

export interface ListHatcheryOffersFilter {
  page: number;
  pageSize: number;
  chickType?: ChickType;
  governorate?: string;
  status?: HatcheryOfferStatus;
  /** Admin listing only. */
  moderationStatus?: MarketModerationStatus;
  /** Admin listing only — offer id / breed / location / phone / notes / seller. */
  search?: string;
}
