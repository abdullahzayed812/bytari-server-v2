import type { Knex } from 'knex';
import { rowToSlide, type AdSlide, type AdSlideRow } from '../domain/advertisement.types.js';

const T = 'ad_slides';

export interface CreateSlideData {
  campaignId: string;
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  sortOrder: number;
  createdByUserId: string;
}

export interface UpdateSlideData {
  title?: string | null;
  subtitle?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  sortOrder?: number;
  updatedByUserId: string;
}

export interface SetSlideImageData {
  imageStorageKey: string;
  imageStorageProvider: string;
  updatedByUserId: string;
}

export class AdSlideRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<AdSlide | null> {
    const row = await this.conn(trx)<AdSlideRow>(T).where({ id }).first();
    return row ? rowToSlide(row) : null;
  }

  async listByCampaign(campaignId: string, trx?: Knex.Transaction): Promise<AdSlide[]> {
    const rows: AdSlideRow[] = await this.conn(trx)<AdSlideRow>(T)
      .where({ campaign_id: campaignId })
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ]);
    return rows.map(rowToSlide);
  }

  /** Slides for many campaigns at once (public list N+1 guard). */
  async listByCampaigns(campaignIds: string[], trx?: Knex.Transaction): Promise<AdSlide[]> {
    if (campaignIds.length === 0) return [];
    const rows: AdSlideRow[] = await this.conn(trx)<AdSlideRow>(T)
      .whereIn('campaign_id', campaignIds)
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ]);
    return rows.map(rowToSlide);
  }

  async countByCampaign(campaignId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)<AdSlideRow>(T)
      .where({ campaign_id: campaignId })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  /** Highest existing sort_order for a campaign, or -1 when it has no slides. */
  async maxSortOrder(campaignId: string, trx?: Knex.Transaction): Promise<number> {
    const row = await this.conn(trx)<AdSlideRow>(T)
      .where({ campaign_id: campaignId })
      .max<{ max: number | null }>({ max: 'sort_order' })
      .first();
    return row?.max ?? -1;
  }

  async create(data: CreateSlideData, trx: Knex.Transaction): Promise<AdSlide> {
    const [row] = (await trx(T)
      .insert({
        campaign_id: data.campaignId,
        title: data.title,
        subtitle: data.subtitle,
        cta_label: data.ctaLabel,
        cta_url: data.ctaUrl,
        sort_order: data.sortOrder,
        created_by_user_id: data.createdByUserId,
        updated_by_user_id: data.createdByUserId,
      })
      .returning('*')) as AdSlideRow[];
    if (!row) throw new Error('ad_slides insert returned no row');
    return rowToSlide(row);
  }

  async update(id: string, patch: UpdateSlideData, trx: Knex.Transaction): Promise<AdSlide> {
    const dbPatch: Record<string, unknown> = {
      updated_by_user_id: patch.updatedByUserId,
      updated_at: trx.fn.now(),
    };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.subtitle !== undefined) dbPatch.subtitle = patch.subtitle;
    if (patch.ctaLabel !== undefined) dbPatch.cta_label = patch.ctaLabel;
    if (patch.ctaUrl !== undefined) dbPatch.cta_url = patch.ctaUrl;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as AdSlideRow[];
    if (!row) throw new Error('ad_slides not found on update');
    return rowToSlide(row);
  }

  async setImage(id: string, data: SetSlideImageData, trx: Knex.Transaction): Promise<AdSlide> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        image_storage_key: data.imageStorageKey,
        image_storage_provider: data.imageStorageProvider,
        updated_by_user_id: data.updatedByUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as AdSlideRow[];
    if (!row) throw new Error('ad_slides not found on image update');
    return rowToSlide(row);
  }

  async delete(id: string, trx: Knex.Transaction): Promise<void> {
    await trx(T).where({ id }).del();
  }

  /** Apply a new order: `orderedIds[i]` gets `sort_order = i`. */
  async reorder(
    campaignId: string,
    orderedIds: string[],
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await trx(T)
        .where({ id: orderedIds[i], campaign_id: campaignId })
        .update({ sort_order: i, updated_by_user_id: actorUserId, updated_at: trx.fn.now() });
    }
  }
}
