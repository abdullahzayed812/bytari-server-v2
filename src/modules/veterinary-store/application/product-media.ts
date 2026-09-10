import type { ObjectStorage } from '../../../infra/storage/index.js';
import { PRODUCT_IMAGE_URL_TTL_SECONDS } from '../domain/store.constants.js';

/**
 * Resolve an R2 object key to a client-usable URL: the stable public URL when
 * the bucket/CDN is public, else a short-lived signed GET URL. Mirrors the
 * convention in `pet-owner-store-media.ts` / `tip.service.ts`. Storage
 * credentials never leave the server.
 */
export function resolveVetStoreImageUrl(
  storage: ObjectStorage,
  key: string,
): Promise<string> | string {
  const publicUrl = storage.getPublicUrl(key);
  if (publicUrl) return publicUrl;
  return storage.getSignedUrl(key, {
    operation: 'get',
    expiresIn: PRODUCT_IMAGE_URL_TTL_SECONDS,
  });
}

export async function resolveVetStoreImageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
): Promise<string | null> {
  if (!key) return null;
  return resolveVetStoreImageUrl(storage, key);
}
