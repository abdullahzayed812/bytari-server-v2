import type { Knex } from 'knex';
import {
  rowToAnnouncement,
  type AnnouncementListFilter,
  type CreateAnnouncementInput,
  type SyndicateAnnouncement,
  type SyndicateAnnouncementRow,
  type UpdateAnnouncementInput,
} from '../domain/syndicate.types.js';

const T = 'syndicate_announcements';

export class SyndicateAnnouncementRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async create(
    organizationId: string,
    createdByUserId: string,
    input: CreateAnnouncementInput,
    trx: Knex.Transaction,
  ): Promise<SyndicateAnnouncement> {
    const [row] = (await trx(T)
      .insert({
        organization_id: organizationId,
        type: input.type,
        title: input.title,
        body: input.body,
        image_key: input.imageStorageKey ?? null,
        created_by_user_id: createdByUserId,
      })
      .returning('*')) as SyndicateAnnouncementRow[];
    if (!row) throw new Error('syndicate_announcement insert returned no row');
    return rowToAnnouncement(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<SyndicateAnnouncement | null> {
    const row = await this.conn(trx)<SyndicateAnnouncementRow>(T).where({ id }).first();
    return row ? rowToAnnouncement(row) : null;
  }

  async update(
    id: string,
    patch: UpdateAnnouncementInput,
    trx: Knex.Transaction,
  ): Promise<SyndicateAnnouncement> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.type !== undefined) dbPatch.type = patch.type;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.body !== undefined) dbPatch.body = patch.body;
    if (patch.imageStorageKey !== undefined) dbPatch.image_key = patch.imageStorageKey;
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as SyndicateAnnouncementRow[];
    if (!row) throw new Error('syndicate_announcement not found on update');
    return rowToAnnouncement(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(T).where({ id }).del();
  }

  async listForOrganization(
    organizationId: string,
    filter: AnnouncementListFilter,
  ): Promise<{ items: SyndicateAnnouncement[]; total: number }> {
    const countRow = await this.conn()(T)
      .where({ organization_id: organizationId })
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await this.conn()<SyndicateAnnouncementRow>(T)
      .where({ organization_id: organizationId })
      .orderBy('published_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as SyndicateAnnouncementRow[];
    return { items: rows.map(rowToAnnouncement), total };
  }

  /** Latest announcements across a set of organizations (e.g. a main syndicate + its branches). */
  async listRecentForOrganizations(
    organizationIds: string[],
    limit: number,
  ): Promise<SyndicateAnnouncement[]> {
    if (organizationIds.length === 0) return [];
    const rows = (await this.conn()<SyndicateAnnouncementRow>(T)
      .whereIn('organization_id', organizationIds)
      .orderBy('published_at', 'desc')
      .limit(limit)) as SyndicateAnnouncementRow[];
    return rows.map(rowToAnnouncement);
  }
}
