import type { Knex } from 'knex';
import {
  rowToEggOffer,
  type CreateEggOfferInput,
  type EggOffer,
  type EggOfferRow,
  type ListEggOffersFilter,
} from '../domain/egg-offer.types.js';

const TABLE = 'egg_offers';

export class EggOfferRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<EggOffer | null> {
    const row = await this.conn(trx)<EggOfferRow>(TABLE).where({ id }).first();
    return row ? rowToEggOffer(row) : null;
  }

  async create(
    traderUserId: string,
    input: CreateEggOfferInput,
    trx: Knex.Transaction,
  ): Promise<EggOffer> {
    const [row] = (await trx(TABLE)
      .insert({
        trader_user_id: traderUserId,
        egg_type: input.eggType,
        sell_unit: input.sellUnit,
        quantity: input.quantity,
        price_per_unit: input.pricePerUnit,
        governorate: input.governorate,
        district: input.district ?? null,
        phone: input.phone,
        whatsapp: input.whatsapp ?? null,
        notes: input.notes ?? null,
        gallery_keys: input.galleryKeys ?? [],
      })
      .returning('*')) as EggOfferRow[];
    if (!row) throw new Error('egg offer insert did not return a row');
    return rowToEggOffer(row);
  }

  async setStatus(id: string, status: string, trx: Knex.Transaction): Promise<EggOffer> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ status, updated_at: new Date() })
      .returning('*')) as EggOfferRow[];
    if (!row) throw new Error('egg offer not found after status update');
    return rowToEggOffer(row);
  }

  async list(
    filter: ListEggOffersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: EggOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<EggOfferRow>(TABLE).where('status', filter.status ?? 'ACTIVE');
      if (filter.eggType) qb.andWhere('egg_type', filter.eggType);
      if (filter.governorate) qb.andWhere('governorate', filter.governorate);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: EggOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToEggOffer), total };
  }

  async listMine(
    traderUserId: string,
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: EggOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<EggOfferRow>(TABLE).where('trader_user_id', traderUserId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: EggOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: rows.map(rowToEggOffer), total };
  }

  async listAdmin(
    filter: ListEggOffersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: EggOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<EggOfferRow>(TABLE);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.eggType) qb.andWhere('egg_type', filter.eggType);
      if (filter.governorate) qb.andWhere('governorate', filter.governorate);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: EggOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToEggOffer), total };
  }
}
