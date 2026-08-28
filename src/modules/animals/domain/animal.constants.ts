/**
 * Animal Core controlled vocabularies. Kept as `text` + CHECK constraints
 * (project convention), NOT catalog tables — the product has no requirement to
 * manage species/breeds as data (spec §7). New species are added by a future
 * migration that relaxes `chk_animals_species`, exactly as Phase 3 relaxed the
 * permission-key CHECK.
 */

export const ANIMAL_SPECIES = [
  'DOG',
  'CAT',
  'BIRD',
  'RABBIT',
  'REPTILE',
  'FISH',
  'HORSE',
  'OTHER',
] as const;
export type AnimalSpecies = (typeof ANIMAL_SPECIES)[number];

export const ANIMAL_SEXES = ['MALE', 'FEMALE', 'UNKNOWN'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/**
 * Animal Core lifecycle ONLY. Listing workflows (LOST / FOR_ADOPTION /
 * FOR_MATING) are future domains and are NOT modelled here (spec §6).
 */
export const ANIMAL_STATUSES = ['ACTIVE', 'DEACTIVATED'] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

/** Animal permission keys (mirrored in `src/modules/rbac/rbac.constants.ts`). */
export const ANIMAL_PERMISSION_KEYS = [
  'animal.read',
  'animal.create',
  'animal.update',
  'animal.delete',
  'animal.ownership.read',
  'animal.ownership.transfer',
] as const;
export type AnimalPermissionKey = (typeof ANIMAL_PERMISSION_KEYS)[number];
