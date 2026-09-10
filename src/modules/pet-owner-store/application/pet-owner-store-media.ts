import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrl, resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { PET_STORE_IMAGE_URL_TTL_SECONDS } from '../domain/pet-owner-store.constants.js';

/** Pet Owners Store convenience wrapper over the shared storage-URL resolver. */
export function resolvePetStoreImageUrl(
  storage: ObjectStorage,
  key: string,
): Promise<string> | string {
  return resolveStorageUrl(storage, key, PET_STORE_IMAGE_URL_TTL_SECONDS);
}

export async function resolvePetStoreImageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
): Promise<string | null> {
  return resolveStorageUrlOrNull(storage, key, PET_STORE_IMAGE_URL_TTL_SECONDS);
}
