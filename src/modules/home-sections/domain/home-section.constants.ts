/**
 * The EXISTING bottom section cards of the two home pages. The cards
 * themselves (titles, routes, fallback icons) live in the app; the server only
 * knows these stable keys so an admin can attach an image to each. Adding a
 * section is a new key here + a CHECK-widening migration — never free text.
 */
export const HOME_SECTION_KEYS = [
  // Pet Owner home — "الأقسام"
  'PET_OWNER_PETS',
  'PET_OWNER_LIVESTOCK',
  'PET_OWNER_POULTRY',
  // Veterinarian home — quick links
  'VET_CHAT',
  'VET_SERVICES',
  'VET_MAGAZINE',
  'VET_BOOKS',
] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

export type HomeSectionPage = 'PET_OWNER_HOME' | 'VETERINARIAN_HOME';

export function homeSectionPage(key: HomeSectionKey): HomeSectionPage {
  return key.startsWith('VET_') ? 'VETERINARIAN_HOME' : 'PET_OWNER_HOME';
}

/** Route guard for every admin write — ADMIN override only (no base role holds it). */
export const HOME_SECTION_PERMISSION_KEY = 'home_section.manage';

/** Same image rules as the other admin-managed visuals (ads, store categories). */
export const HOME_SECTION_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const HOME_SECTION_ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const HOME_SECTION_UPLOAD_URL_TTL_SECONDS = 900;
export const HOME_SECTION_IMAGE_URL_TTL_SECONDS = 3600;
