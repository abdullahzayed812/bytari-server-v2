/**
 * Which animal section a News item / Tip belongs to (additional corrections
 * §11): Pet Animals, Sheep, Cattle, Poultry each show ONLY their own items.
 * `null` = general — still in the global News / Tips lists, never in a
 * section's feed.
 */
export const ANIMAL_SECTIONS = ['PETS', 'SHEEP', 'CATTLE', 'POULTRY'] as const;
export type AnimalSection = (typeof ANIMAL_SECTIONS)[number];
