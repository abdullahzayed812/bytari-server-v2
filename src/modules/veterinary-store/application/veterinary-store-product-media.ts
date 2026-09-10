import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrl, resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { VETERINARY_STORE_PRODUCT_IMAGE_URL_TTL_SECONDS } from '../domain/veterinary-store-product.constants.js';

/** Veterinary Store convenience wrapper over the shared storage-URL resolver. */
export function resolveVeterinaryStoreProductImageUrl(
  storage: ObjectStorage,
  key: string,
): Promise<string> | string {
  return resolveStorageUrl(storage, key, VETERINARY_STORE_PRODUCT_IMAGE_URL_TTL_SECONDS);
}

export async function resolveVeterinaryStoreProductImageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
): Promise<string | null> {
  return resolveStorageUrlOrNull(storage, key, VETERINARY_STORE_PRODUCT_IMAGE_URL_TTL_SECONDS);
}
