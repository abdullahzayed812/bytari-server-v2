import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Storage key conventions. Keys are `/`-delimited, lowercase, no leading slash.
 * Grouping by domain keeps lifecycle rules (e.g. retention on medical
 * attachments) easy to target later.
 */
export const StoragePrefix = {
  contentFiles: 'content',
  books: 'content/books',
  magazines: 'content/magazines',
  articles: 'content/articles',
  tipCovers: 'content/tips',
  animalImages: 'animals',
  userUploads: 'users',
  userAvatars: 'users/avatars',
  organizationFiles: 'organizations',
  medicalAttachments: 'medical-records',
  veterinarianDocuments: 'veterinarians/documents',
  advertisements: 'advertisements',
  poultryOfferImages: 'market/poultry-offers',
  eggOfferImages: 'market/egg-offers',
  petOwnerStoreProducts: 'pet-owner-store/products',
  petOwnerStoreCategories: 'pet-owner-store/categories',
  vetServiceImages: 'vet-services',
  veterinaryStoreProductImages: 'veterinary-store/products',
  veterinaryOfficeProductImages: 'veterinary-office/products',
  misc: 'misc',
} as const;

/**
 * Normalise a key: `\` → `/`, collapse empty segments, and drop `.` / `..`
 * segments so a key can never traverse outside its intended prefix.
 */
export function sanitizeKey(key: string): string {
  const normalized = key
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
  if (!normalized) throw new Error('Storage key cannot be empty');
  return normalized;
}

/**
 * Build a collision-resistant key: `<prefix>/<yyyy>/<mm>/<uuid><ext>`.
 * `originalName` is used only to preserve a sensible file extension.
 */
export function buildObjectKey(prefix: string, originalName?: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = originalName ? path.extname(originalName).toLowerCase().slice(0, 12) : '';
  return sanitizeKey(`${prefix}/${yyyy}/${mm}/${randomUUID()}${ext}`);
}
