import type { ObjectStorage } from '../../infra/storage/index.js';

/**
 * Resolve an R2 object key to a client-usable URL: the stable public URL when
 * the bucket/CDN is public, else a short-lived signed GET URL. Shared
 * low-level infrastructure — every catalog domain (Pet Owner Store, Veterinary
 * Store, Veterinary Office) uses this exact resolution rule, but the business
 * data (which keys belong to which product) stays entirely domain-scoped.
 * Storage credentials never leave the server.
 */
export function resolveStorageUrl(
  storage: ObjectStorage,
  key: string,
  ttlSeconds: number,
): Promise<string> | string {
  const publicUrl = storage.getPublicUrl(key);
  if (publicUrl) return publicUrl;
  return storage.getSignedUrl(key, { operation: 'get', expiresIn: ttlSeconds });
}

export async function resolveStorageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
  ttlSeconds: number,
): Promise<string | null> {
  if (!key) return null;
  return resolveStorageUrl(storage, key, ttlSeconds);
}
