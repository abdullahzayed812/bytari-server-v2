import type { Knex } from 'knex';
import { ValidationError } from '../../../shared/errors/app-error.js';
import { BATCH_LINKS, type FarmBatchLinkInput } from '../domain/farm-batch-link.js';

/** Left-joins the three batch tables onto `alias` and selects `batch_name` / `batch_number`. */
export function selectBatchLink(db: Knex, qb: Knex.QueryBuilder, alias: string): Knex.QueryBuilder {
  return qb
    .leftJoin('poultry_flocks as lpf', 'lpf.id', `${alias}.poultry_flock_id`)
    .leftJoin('sheep_batches as lsb', 'lsb.id', `${alias}.sheep_batch_id`)
    .leftJoin('cattle_batches as lcb', 'lcb.id', `${alias}.cattle_batch_id`)
    .select(
      db.raw('COALESCE(lpf.name, lsb.name, lcb.name) AS batch_name'),
      db.raw('COALESCE(lpf.batch_number, lsb.batch_number, lcb.batch_number) AS batch_number'),
    );
}

/**
 * The linked batch must be an ACTIVE batch of THIS farm: a batch id from
 * another organization is rejected (it would otherwise leak into, or be
 * purged by, a stranger's sale), and a sold batch takes no new rows.
 */
export async function assertBatchLinkable(
  db: Knex,
  organizationId: string,
  input: FarmBatchLinkInput,
): Promise<void> {
  const set = BATCH_LINKS.filter((l) => input[l.key]);
  if (set.length > 1) {
    throw new ValidationError('Link at most one batch', [
      { path: set[1]!.key, message: 'Only one batch can be linked' },
    ]);
  }
  const link = set[0];
  if (!link) return;
  const row = await db<{ id: string; organization_id: string; status: string }>(link.table)
    .where({ id: input[link.key] as string, organization_id: organizationId })
    .first('status');
  if (!row || row.status !== 'ACTIVE') {
    throw new ValidationError('The batch must be an active batch of this farm', [
      { path: link.key, message: 'Not an active batch of this farm' },
    ]);
  }
}
