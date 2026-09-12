import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrl, resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { VETERINARIAN_STORE_IMAGE_URL_TTL_SECONDS } from '../domain/veterinarian-store.constants.js';

/** Veterinarian Store convenience wrapper over the shared storage-URL resolver. */
export function resolveVeterinarianStoreImageUrl(
  storage: ObjectStorage,
  key: string,
): Promise<string> | string {
  return resolveStorageUrl(storage, key, VETERINARIAN_STORE_IMAGE_URL_TTL_SECONDS);
}

export async function resolveVeterinarianStoreImageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
): Promise<string | null> {
  return resolveStorageUrlOrNull(storage, key, VETERINARIAN_STORE_IMAGE_URL_TTL_SECONDS);
}
