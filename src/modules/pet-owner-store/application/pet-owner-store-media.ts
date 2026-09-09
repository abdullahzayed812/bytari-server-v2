import type { ObjectStorage } from '../../../infra/storage/index.js';
import { PET_STORE_IMAGE_URL_TTL_SECONDS } from '../domain/pet-owner-store.constants.js';

/**
 * Resolve an R2 object key to a client-usable URL: the stable public URL when
 * the bucket/CDN is public, else a short-lived signed GET URL. Mirrors the
 * convention in `tip.service.ts` / `advertisement.service.ts`. Storage
 * credentials never leave the server.
 */
export function resolvePetStoreImageUrl(
  storage: ObjectStorage,
  key: string,
): Promise<string> | string {
  const publicUrl = storage.getPublicUrl(key);
  if (publicUrl) return publicUrl;
  return storage.getSignedUrl(key, {
    operation: 'get',
    expiresIn: PET_STORE_IMAGE_URL_TTL_SECONDS,
  });
}

export async function resolvePetStoreImageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
): Promise<string | null> {
  if (!key) return null;
  return resolvePetStoreImageUrl(storage, key);
}
