/**
 * A manual farm expense or farm appointment may belong to ONE batch of the
 * farm — a poultry flock, a sheep batch or a cattle batch — through one of
 * three nullable columns (DB CHECK: at most one set). A row with none is
 * farm-wide. Selling the batch permanently deletes the rows linked to it
 * (`sold-batch-expenses.ts`).
 */
export type FarmBatchKind = 'POULTRY' | 'SHEEP' | 'CATTLE';

export interface FarmBatchRef {
  kind: FarmBatchKind;
  id: string;
  name: string;
  batchNumber: number | null;
}

export interface FarmBatchLinkInput {
  poultryFlockId?: string | null;
  sheepBatchId?: string | null;
  cattleBatchId?: string | null;
}

export interface FarmBatchLinkFields {
  poultryFlockId: string | null;
  sheepBatchId: string | null;
  cattleBatchId: string | null;
  /** The linked batch (name for display), or null for a farm-wide row. */
  batch: FarmBatchRef | null;
}

export interface FarmBatchLinkRow {
  poultry_flock_id: string | null;
  sheep_batch_id?: string | null;
  cattle_batch_id?: string | null;
  /** Joined by {@link selectBatchLink}. */
  batch_name?: string | null;
  batch_number?: number | string | null;
}

export const BATCH_LINKS = [
  { kind: 'POULTRY', key: 'poultryFlockId', column: 'poultry_flock_id', table: 'poultry_flocks' },
  { kind: 'SHEEP', key: 'sheepBatchId', column: 'sheep_batch_id', table: 'sheep_batches' },
  { kind: 'CATTLE', key: 'cattleBatchId', column: 'cattle_batch_id', table: 'cattle_batches' },
] as const;

export function batchLinkFromRow(r: FarmBatchLinkRow): FarmBatchLinkFields {
  const ids = {
    POULTRY: r.poultry_flock_id ?? null,
    SHEEP: r.sheep_batch_id ?? null,
    CATTLE: r.cattle_batch_id ?? null,
  };
  const linked = BATCH_LINKS.find((l) => ids[l.kind]);
  return {
    poultryFlockId: ids.POULTRY,
    sheepBatchId: ids.SHEEP,
    cattleBatchId: ids.CATTLE,
    batch: linked
      ? {
          kind: linked.kind,
          id: ids[linked.kind] as string,
          name: r.batch_name ?? '',
          batchNumber: r.batch_number == null ? null : Number(r.batch_number),
        }
      : null,
  };
}

/**
 * DB patch for the link. Sending any of the three keys re-links the row: the
 * named batch is set and the other two are cleared, so the single-batch CHECK
 * always holds. No key sent → no change.
 */
export function batchLinkPatch(input: FarmBatchLinkInput): Record<string, string | null> {
  if (BATCH_LINKS.every((l) => input[l.key] === undefined)) return {};
  const patch: Record<string, string | null> = {};
  for (const l of BATCH_LINKS) patch[l.column] = input[l.key] ?? null;
  return patch;
}
