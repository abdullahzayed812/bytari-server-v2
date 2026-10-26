import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { ServiceUnavailableError } from '../../../shared/errors/app-error.js';

/**
 * Is `storageKey` still referenced by any content-module row? Covers every
 * place the module stores an object key: news cover + gallery, tip cover and
 * live `content_files` rows (books / magazines). Soft-deleted news / tips
 * count — they can be restored with their images; a soft-deleted
 * `content_files` row does not (its object is removed when it is deleted).
 *
 * Run it inside the transaction that dropped the caller's own reference, so
 * that reference is already gone and only OTHER users of the key remain.
 */
export async function isContentStorageKeyReferenced(
  conn: Knex | Knex.Transaction,
  storageKey: string,
): Promise<boolean> {
  const row = (await conn
    .select(
      conn.raw(
        `EXISTS (SELECT 1 FROM news WHERE cover_image_storage_key = ? OR ? = ANY(gallery_keys))
         OR EXISTS (SELECT 1 FROM content_tips WHERE cover_image_storage_key = ?)
         OR EXISTS (SELECT 1 FROM content_files WHERE storage_key = ? AND deleted_at IS NULL)
         AS referenced`,
        [storageKey, storageKey, storageKey, storageKey],
      ),
    )
    .first()) as { referenced: boolean } | undefined;
  return row?.referenced === true;
}

/**
 * Explicit admin "delete this image": call it inside the transaction that
 * drops the row's reference, AFTER dropping it. The object is deleted only
 * when nothing else references the key. Unlike the after-commit, best-effort
 * cleanup used when an image is REPLACED, this runs before commit on purpose:
 * a storage failure throws (503) and rolls the reference back, so the image
 * stays visible and the admin can retry — the object is never orphaned. An
 * already-missing object is not an error (storage deletes are idempotent).
 *
 * @returns whether the object was deleted (false = still referenced elsewhere).
 */
export async function deleteUnreferencedContentObject(
  tx: Knex.Transaction,
  storage: ObjectStorage,
  log: Logger,
  storageKey: string,
  context: Record<string, unknown>,
): Promise<boolean> {
  if (await isContentStorageKeyReferenced(tx, storageKey)) return false;
  try {
    await storage.delete(storageKey);
  } catch (err) {
    log.error({ err, ...context }, 'failed to delete image from storage — reference kept');
    throw new ServiceUnavailableError('The image could not be deleted from storage; try again');
  }
  return true;
}
