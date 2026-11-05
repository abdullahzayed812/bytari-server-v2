import type { Knex } from 'knex';
import { whereVisibleMarketSeller } from './market-access.repository.js';
import {
  rowToHatcheryOffer,
  type CreateHatcheryOfferInput,
  type HatcheryOffer,
  type HatcheryOfferRow,
  type ListHatcheryOffersFilter,
} from '../domain/hatchery-offer.types.js';
import { matchingUserIds, whereTextSearch } from '../../../shared/database/search.js';

const TABLE = 'hatchery_offers';

/** Hatchery offers ("عروض المفاقس") — same query shapes as {@link EggOfferRepository}. */
export class HatcheryOfferRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<HatcheryOffer | null> {
    const row = await this.conn(trx)<HatcheryOfferRow>(TABLE).where({ id }).first();
    return row ? rowToHatcheryOffer(row) : null;
  }

  async create(
    traderUserId: string,
    input: CreateHatcheryOfferInput,
    trx: Knex.Transaction,
  ): Promise<HatcheryOffer> {
    const [row] = (await trx(TABLE)
      .insert({
        trader_user_id: traderUserId,
        chick_type: input.chickType,
        breed: input.breed ?? null,
        chick_age_days: input.chickAgeDays,
        production_date: input.productionDate,
        quantity: input.quantity ?? null,
        price_per_chick: input.pricePerChick ?? null,
        governorate: input.governorate,
        district: input.district ?? null,
        phone: input.phone,
        whatsapp: input.whatsapp ?? null,
        notes: input.notes ?? null,
        gallery_keys: input.galleryKeys ?? [],
      })
      .returning('*')) as HatcheryOfferRow[];
    if (!row) throw new Error('hatchery offer insert did not return a row');
    return rowToHatcheryOffer(row);
  }

  async setStatus(id: string, status: string, trx: Knex.Transaction): Promise<HatcheryOffer> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({ status, updated_at: new Date() })
      .returning('*')) as HatcheryOfferRow[];
    if (!row) throw new Error('hatchery offer not found after status update');
    return rowToHatcheryOffer(row);
  }

  async list(
    filter: ListHatcheryOffersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: HatcheryOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      // Public browse: live AND approved by a moderator.
      const qb = this.conn(trx)<HatcheryOfferRow>(TABLE)
        .where('status', filter.status ?? 'ACTIVE')
        .andWhere('moderation_status', 'APPROVED');
      // Only sellers with a currently eligible account stay on the market.
      whereVisibleMarketSeller(qb, this.conn(trx));
      if (filter.chickType) qb.andWhere('chick_type', filter.chickType);
      if (filter.governorate) qb.andWhere('governorate', filter.governorate);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: HatcheryOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToHatcheryOffer), total };
  }

  async listMine(
    traderUserId: string,
    page: number,
    pageSize: number,
    trx?: Knex.Transaction,
  ): Promise<{ items: HatcheryOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<HatcheryOfferRow>(TABLE).where('trader_user_id', traderUserId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: HatcheryOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: rows.map(rowToHatcheryOffer), total };
  }

  async listAdmin(
    filter: ListHatcheryOffersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: HatcheryOffer[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<HatcheryOfferRow>(TABLE);
      if (filter.status) qb.andWhere('status', filter.status);
      if (filter.moderationStatus) qb.andWhere('moderation_status', filter.moderationStatus);
      if (filter.chickType) qb.andWhere('chick_type', filter.chickType);
      if (filter.governorate) qb.andWhere('governorate', filter.governorate);
      if (filter.search) {
        // Offer id / breed / location / phone / notes, or the seller (trade name or account identity).
        const term = filter.search;
        const conn = this.conn(trx);
        qb.where((w) => {
          whereTextSearch(w, term, {
            columns: ['breed', 'governorate', 'district', 'phone', 'whatsapp', 'notes'],
            ids: ['id'],
          });
          void w
            .orWhereIn('trader_user_id', matchingUserIds(conn, term))
            .orWhereIn('trader_user_id', (sub) => {
              void sub.from('trader_profiles as tp').select('tp.user_id');
              whereTextSearch(sub, term, { columns: ['tp.display_name', 'tp.phone'] });
            });
        });
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: HatcheryOfferRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return { items: rows.map(rowToHatcheryOffer), total };
  }

  /** PENDING → APPROVED / REJECTED; `null` when it was no longer PENDING (race-safe). */
  async moderate(
    id: string,
    decision: { status: 'APPROVED' | 'REJECTED'; reason: string | null; reviewerUserId: string },
    trx: Knex.Transaction,
  ): Promise<HatcheryOffer | null> {
    const [row] = (await trx(TABLE)
      .where({ id, moderation_status: 'PENDING' })
      .update({
        moderation_status: decision.status,
        rejection_reason: decision.reason,
        reviewed_by_user_id: decision.reviewerUserId,
        reviewed_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*')) as HatcheryOfferRow[];
    return row ? rowToHatcheryOffer(row) : null;
  }
}
