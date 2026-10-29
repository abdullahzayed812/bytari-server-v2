import type { Knex } from 'knex';
import {
  rowToSyndicateServiceItem,
  SYNDICATE_SERVICE_KEYS,
  type SyndicateServiceItem,
  type SyndicateServiceItemRow,
  type SyndicateServiceItemPatch,
} from '../domain/syndicate-service-item.types.js';

const T = 'syndicate_services';

export class SyndicateServiceItemRepository {
  constructor(private readonly db: Knex) {}

  /**
   * Make sure the syndicate has its row for every service key. Idempotent
   * (`ON CONFLICT DO NOTHING` on the per-syndicate unique key), so concurrent
   * first reads can never create a duplicate service.
   */
  async ensureFor(organizationId: string): Promise<void> {
    await this.db(T)
      .insert(
        SYNDICATE_SERVICE_KEYS.map((key, i) => ({
          organization_id: organizationId,
          service_key: key,
          sort_order: i + 1,
        })),
      )
      .onConflict(['organization_id', 'service_key'])
      .ignore();
  }

  async listFor(organizationId: string): Promise<SyndicateServiceItem[]> {
    const rows: SyndicateServiceItemRow[] = await this.db(T)
      .where({ organization_id: organizationId })
      .orderBy([{ column: 'sort_order' }, { column: 'service_key' }]);
    return rows.map(rowToSyndicateServiceItem);
  }

  async findForOrganization(
    id: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<SyndicateServiceItem | null> {
    const row = (await (trx ?? this.db)(T)
      .where({ id, organization_id: organizationId })
      .first()) as SyndicateServiceItemRow | undefined;
    return row ? rowToSyndicateServiceItem(row) : null;
  }

  /** Updates the existing row in place — the id, key and syndicate never change. */
  async update(
    id: string,
    patch: SyndicateServiceItemPatch,
    updatedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<SyndicateServiceItem> {
    const dbPatch: Record<string, unknown> = {
      updated_at: new Date(),
      updated_by_user_id: updatedByUserId,
    };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.isEnabled !== undefined) dbPatch.is_enabled = patch.isEnabled;
    if (patch.content !== undefined) {
      dbPatch.content = patch.content === null ? null : JSON.stringify(patch.content);
    }
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as
      SyndicateServiceItemRow[] | [];
    if (!row) throw new Error('syndicate service not found after update');
    return rowToSyndicateServiceItem(row);
  }
}
