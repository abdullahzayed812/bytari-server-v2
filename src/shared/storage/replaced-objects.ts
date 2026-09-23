import type { Logger } from 'pino';
import type { ObjectStorage } from '../../infra/storage/index.js';

/**
 * Best-effort deletion of R2 objects a write just orphaned.
 *
 * Every "replace this entity's image" path persists a NEW storage key over an
 * old one; without this, the old object stays in the bucket forever with
 * nothing referencing it. Mirrors the pattern `UserService.finalizeAvatar` and
 * `AnimalService.removeGalleryImage` already use:
 *
 *  - call it AFTER the transaction commits — storage I/O never runs inside one;
 *  - never fail the caller's request because a delete failed (the row is
 *    already correct; a stray object is a sweepable nuisance, not an error);
 *  - a key still present in `next` is NOT deleted, so a no-op patch that
 *    re-sends the same key is safe.
 *
 * Keys are compared by value, so this works for a single key or a gallery.
 */
export async function deleteReplacedObjects(
  storage: ObjectStorage,
  log: Logger,
  previous: ReadonlyArray<string | null | undefined>,
  next: ReadonlyArray<string | null | undefined>,
  context: Record<string, unknown> = {},
): Promise<void> {
  const kept = new Set(next.filter((k): k is string => Boolean(k)));
  const orphaned = [...new Set(previous.filter((k): k is string => Boolean(k)))].filter(
    (key) => !kept.has(key),
  );
  if (orphaned.length === 0) return;

  await Promise.all(
    orphaned.map(async (key) => {
      try {
        await storage.delete(key);
      } catch (err) {
        // NB: the key is an internal identifier, never user content — safe to log.
        log.error({ err, key, ...context }, 'failed to delete replaced storage object — needs a sweep');
      }
    }),
  );
}
