import type { BirdType, PoultryOfferStatus, PricingMethod } from './poultry-offer.constants.js';

export interface PoultryOffer {
  id: string;
  traderUserId: string;
  birdType: BirdType;
  breed: string | null;
  quantity: number;
  pricingMethod: PricingMethod;
  /** Decimal string (PostgreSQL numeric). Never a JS float. */
  price: string;
  ageWeeks: number | null;
  weightKg: string | null;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  notes: string | null;
  galleryKeys: string[];
  status: PoultryOfferStatus;
  createdAt: string;
  updatedAt: string;
}

/** API DTO — adds resolved image URLs, never the raw storage keys. */
export interface PoultryOfferDTO extends Omit<PoultryOffer, 'galleryKeys'> {
  imageUrls: string[];
}

export interface PoultryOfferRow {
  id: string;
  trader_user_id: string;
  bird_type: string;
  breed: string | null;
  quantity: number;
  pricing_method: string;
  price: string;
  age_weeks: number | null;
  weight_kg: string | null;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  notes: string | null;
  gallery_keys: string[] | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export function rowToPoultryOffer(row: PoultryOfferRow): PoultryOffer {
  return {
    id: row.id,
    traderUserId: row.trader_user_id,
    birdType: row.bird_type as BirdType,
    breed: row.breed,
    quantity: Number(row.quantity),
    pricingMethod: row.pricing_method as PricingMethod,
    price: row.price,
    ageWeeks: row.age_weeks === null ? null : Number(row.age_weeks),
    weightKg: row.weight_kg,
    governorate: row.governorate,
    district: row.district,
    phone: row.phone,
    whatsapp: row.whatsapp,
    notes: row.notes,
    galleryKeys: row.gallery_keys ?? [],
    status: row.status as PoultryOfferStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPoultryOfferDTO(offer: PoultryOffer, imageUrls: string[]): PoultryOfferDTO {
  const { galleryKeys: _galleryKeys, ...rest } = offer;
  return { ...rest, imageUrls };
}

export interface CreatePoultryOfferInput {
  birdType: BirdType;
  breed?: string | null;
  quantity: number;
  pricingMethod: PricingMethod;
  price: string;
  ageWeeks?: number | null;
  weightKg?: string | null;
  governorate: string;
  district?: string | null;
  phone: string;
  whatsapp?: string | null;
  notes?: string | null;
  galleryKeys?: string[];
}

export interface ListPoultryOffersFilter {
  page: number;
  pageSize: number;
  birdType?: BirdType;
  governorate?: string;
  status?: PoultryOfferStatus;
}
