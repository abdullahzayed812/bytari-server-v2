import type { EggOfferStatus, EggType, SellUnit } from './egg-offer.constants.js';

export interface EggOffer {
  id: string;
  traderUserId: string;
  eggType: EggType;
  sellUnit: SellUnit;
  quantity: number;
  /** Decimal string (PostgreSQL numeric). Never a JS float. */
  pricePerUnit: string;
  governorate: string;
  district: string | null;
  phone: string;
  whatsapp: string | null;
  notes: string | null;
  galleryKeys: string[];
  status: EggOfferStatus;
  createdAt: string;
  updatedAt: string;
}

/** API DTO — adds resolved image URLs, never the raw storage keys. */
export interface EggOfferDTO extends Omit<EggOffer, 'galleryKeys'> {
  imageUrls: string[];
}

export interface EggOfferRow {
  id: string;
  trader_user_id: string;
  egg_type: string;
  sell_unit: string;
  quantity: number;
  price_per_unit: string;
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

export function rowToEggOffer(row: EggOfferRow): EggOffer {
  return {
    id: row.id,
    traderUserId: row.trader_user_id,
    eggType: row.egg_type as EggType,
    sellUnit: row.sell_unit as SellUnit,
    quantity: Number(row.quantity),
    pricePerUnit: row.price_per_unit,
    governorate: row.governorate,
    district: row.district,
    phone: row.phone,
    whatsapp: row.whatsapp,
    notes: row.notes,
    galleryKeys: row.gallery_keys ?? [],
    status: row.status as EggOfferStatus,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toEggOfferDTO(offer: EggOffer, imageUrls: string[]): EggOfferDTO {
  const { galleryKeys: _galleryKeys, ...rest } = offer;
  return { ...rest, imageUrls };
}

export interface CreateEggOfferInput {
  eggType: EggType;
  sellUnit: SellUnit;
  quantity: number;
  pricePerUnit: string;
  governorate: string;
  district?: string | null;
  phone: string;
  whatsapp?: string | null;
  notes?: string | null;
  galleryKeys?: string[];
}

export interface ListEggOffersFilter {
  page: number;
  pageSize: number;
  eggType?: EggType;
  governorate?: string;
  status?: EggOfferStatus;
}
