import { z } from 'zod';

/**
 * Governorates (first-level subdivisions) per country, keyed by ISO 3166-1
 * alpha-2. Values are the Arabic display names the mobile app stores verbatim
 * (the same strings the farm / vet-services pickers already use).
 *
 * Only the current target geography (Iraq) has a fixed list; for any other
 * country the governorate is accepted as bounded free text. Adding a country
 * is one entry here plus the mirrored mobile list
 * (`mobile/src/constants/governorates.ts`).
 */
export const GOVERNORATES_BY_COUNTRY: Readonly<Record<string, readonly string[]>> = {
  IQ: [
    'بغداد',
    'البصرة',
    'نينوى',
    'أربيل',
    'النجف',
    'كربلاء',
    'بابل',
    'ذي قار',
    'الأنبار',
    'ديالى',
    'كركوك',
    'صلاح الدين',
    'واسط',
    'ميسان',
    'المثنى',
    'القادسية',
    'دهوك',
    'السليمانية',
    'حلبجة',
  ],
};

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code');

export const governorateSchema = z.string().trim().min(1).max(100);

/** True when `governorate` is acceptable for `country` (fixed list where one exists). */
export function isValidGovernorate(country: string, governorate: string): boolean {
  const list = GOVERNORATES_BY_COUNTRY[country.toUpperCase()];
  return list ? list.includes(governorate) : true;
}
