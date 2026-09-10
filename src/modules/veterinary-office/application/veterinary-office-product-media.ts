import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrl, resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import { VETERINARY_OFFICE_PRODUCT_IMAGE_URL_TTL_SECONDS } from '../domain/veterinary-office-product.constants.js';

/** Veterinary Office convenience wrapper over the shared storage-URL resolver. */
export function resolveVeterinaryOfficeProductImageUrl(
  storage: ObjectStorage,
  key: string,
): Promise<string> | string {
  return resolveStorageUrl(storage, key, VETERINARY_OFFICE_PRODUCT_IMAGE_URL_TTL_SECONDS);
}

export async function resolveVeterinaryOfficeProductImageUrlOrNull(
  storage: ObjectStorage,
  key: string | null,
): Promise<string | null> {
  return resolveStorageUrlOrNull(storage, key, VETERINARY_OFFICE_PRODUCT_IMAGE_URL_TTL_SECONDS);
}
