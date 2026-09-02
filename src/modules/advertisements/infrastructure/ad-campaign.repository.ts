import type { Knex } from 'knex';
import type { AdPlacement, AdType } from '../domain/advertisement.constants.js';
import {
  rowToCampaign,
  type AdCampaign,
  type AdCampaignRow,
  type ListCampaignsFilter,
} from '../domain/advertisement.types.js';

const T = 'ad_campaigns';

export interface CreateCampaignData {
  placement: AdPlacement;
  type: AdType;
  title: string;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  createdByUserId: string;
}

export interface UpdateCampaignData {
  title?: string;
  sortOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  updatedByUserId: string;
}

export class AdCampaignRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<AdCampaign | null> {
    const row = await this.conn(trx)<AdCampaignRow>(T).where({ id }).first();
    return row ? rowToCampaign(row) : null;
  }

  async create(data: CreateCampaignData, trx: Knex.Transaction): Promise<AdCampaign> {
    const [row] = (await trx(T)
      .insert({
        placement: data.placement,
        type: data.type,
        title: data.title,
        sort_order: data.sortOrder,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        created_by_user_id: data.createdByUserId,
        updated_by_user_id: data.createdByUserId,
      })
      .returning('*')) as AdCampaignRow[];
    if (!row) throw new Error('ad_campaigns insert returned no row');
    return rowToCampaign(row);
  }

  async update(id: string, patch: UpdateCampaignData, trx: Knex.Transaction): Promise<AdCampaign> {
    const dbPatch: Record<string, unknown> = {
      updated_by_user_id: patch.updatedByUserId,
      updated_at: trx.fn.now(),
    };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.sortOrder !== undefined) dbPatch.sort_order = patch.sortOrder;
    if (patch.startsAt !== undefined) dbPatch.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) dbPatch.ends_at = patch.endsAt;

    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as AdCampaignRow[];
    if (!row) throw new Error('ad_campaigns not found on update');
    return rowToCampaign(row);
  }

  async setActive(
    id: string,
    isActive: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<AdCampaign> {
    const [row] = (await trx(T)
      .where({ id })
      .update({ is_active: isActive, updated_by_user_id: actorUserId, updated_at: trx.fn.now() })
      .returning('*')) as AdCampaignRow[];
    if (!row) throw new Error('ad_campaigns not found on activate/deactivate');
    return rowToCampaign(row);
  }

  async setDeleted(
    id: string,
    deleted: boolean,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<AdCampaign> {
    const [row] = (await trx(T)
      .where({ id })
      .update({
        deleted_at: deleted ? trx.fn.now() : null,
        updated_by_user_id: actorUserId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as AdCampaignRow[];
    if (!row) throw new Error('ad_campaigns not found on delete toggle');
    return rowToCampaign(row);
  }

  /** Active, in-window, not-deleted campaigns for one placement, in display order. */
  async listPublic(placement: AdPlacement, trx?: Knex.Transaction): Promise<AdCampaign[]> {
    const now = new Date();
    const rows: AdCampaignRow[] = await this.conn(trx)<AdCampaignRow>(T)
      .where('placement', placement)
      .where('is_active', true)
      .whereNull('deleted_at')
      .where((qb) => {
        void qb.whereNull('starts_at').orWhere('starts_at', '<=', now);
      })
      .where((qb) => {
        void qb.whereNull('ends_at').orWhere('ends_at', '>=', now);
      })
      .orderBy([
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'asc' },
      ]);
    return rows.map(rowToCampaign);
  }

  async listAdmin(
    filter: ListCampaignsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AdCampaign[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): void => {
      if (!filter.includeDeleted) qb.whereNull('deleted_at');
      if (filter.placement) qb.where('placement', filter.placement);
      if (filter.type) qb.where('type', filter.type);
    };

    const countRow = await this.conn(trx)<AdCampaignRow>(T)
      .modify(apply)
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: AdCampaignRow[] = await this.conn(trx)<AdCampaignRow>(T)
      .modify(apply)
      .orderBy([
        { column: 'placement', order: 'asc' },
        { column: 'sort_order', order: 'asc' },
        { column: 'created_at', order: 'desc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToCampaign), total };
  }
}
