import type { Knex } from 'knex';
import {
  rowToPoultryOffer,
  type CreatePoultryOfferInput,
  type ListPoultryOffersFilter,
  type PoultryOffer,
  type PoultryOfferRow,
} from '../domain/poultry-offer.types.js';

const TABLE = 'poultry_offers';

export class PoultryOfferRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<PoultryOffer | null> {
    const row = await this.conn(trx)<PoultryOfferRow>(TABLE).where({ id }).first();
    return row ? rowToPoultryOffer(row) : null;
  }

  async create(
    traderUserId: string,
    input: CreatePoultryOfferInput,
    trx: Knex.Transaction,
  ): Promise<PoultryOffer> {
    const [row] = (await trx(TABLE)
      .insert({
        trader_user_id: traderUserId,
        bird_type: input.birdType,
        breed: input.breed ?? null,
        quantity: input.quantity,
        pricing_method: input.pricingMethod,
        price: input.price,
        age_weeks: input.ageWeeks ?? null,
        weight_kg: input.weightKg ?? null,
        governorate: input.governorate,
        district: input.district ?? null,
        phone: input.phone,
        whatsapp: input.whatsapp ?? null,
        notes: input.notes ?? null,
        gallery_keys: input.galleryKeys ?? [],
      })
      .returning('*')) as PoultryOfferRow[];
    if (!row) throw new Error('poultry offer insert did not return a row');
    return rowToPoultryOffer(row);
  }

  async setStatus(id: string, status: string, trx: Knex.Transaction): Promise<PoultryOffer> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ status, updated_at: new Date() })
      .returning('*')) as PoultryOfferRow[];
    if (!row) throw new Error('poultry offer not found after status update');
    return rowToPoultryOffer(row);
  }

  /** Public/trader browse — ACTIVE offers only by default. */
  async list(
    filter: ListPoultryOffersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: PoultryOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<PoultryOfferRow>(TABLE).where('status', filter.status ?? 'ACTIVE');
      if (filter.birdType) qb.andWhere('bird_type', filter.birdType);
      if (filter.governorate) qb.andWhere('governorate', filter.governorate);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: PoultryOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToPoultryOffer), total };
  }

  async listMine(
    traderUserId: string,
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: PoultryOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<PoultryOfferRow>(TABLE).where('trader_user_id', traderUserId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: PoultryOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: rows.map(rowToPoultryOffer), total };
  }

  /** Admin/moderation listing — every status, optional filters. */
  async listAdmin(
    filter: ListPoultryOffersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: PoultryOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<PoultryOfferRow>(TABLE);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.birdType) qb.andWhere('bird_type', filter.birdType);
      if (filter.governorate) qb.andWhere('governorate', filter.governorate);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: PoultryOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToPoultryOffer), total };
  }
}
