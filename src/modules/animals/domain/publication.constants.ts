/**
 * Phase 7 — Animal lifecycle publications (Lost / Adoption / Mating).
 *
 * All three share one reusable approval lifecycle. The spec (docs 04 §4.14,
 * docs 05 UC-005/006/007) defines only PENDING → APPROVED / REJECTED.
 */

export const PUBLICATION_KINDS = ['LOST', 'ADOPTION', 'MATING'] as const;
export type PublicationKind = (typeof PUBLICATION_KINDS)[number];

export const PUBLICATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Self-declared, listing-time claims — not a verified medical record. */
export const HEALTH_STATUSES = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const VACCINATION_STATUSES = ['COMPLETE', 'PARTIAL', 'NONE'] as const;
export type VaccinationStatus = (typeof VACCINATION_STATUSES)[number];

/** A viewer's fire-and-forget interaction with a listing — notifies the owner, no workflow. */
export const PUBLICATION_INTERACTION_TYPES = ['REQUEST', 'SIGHTING'] as const;
export type PublicationInteractionType = (typeof PUBLICATION_INTERACTION_TYPES)[number];

/** Audit action names per kind + transition (mirrors docs §25). */
export const PUBLICATION_AUDIT_ACTIONS: Record<
  PublicationKind,
  { created: string; approved: string; rejected: string }
> = {
  LOST: {
    created: 'LOST_ANIMAL_CREATED',
    approved: 'LOST_ANIMAL_APPROVED',
    rejected: 'LOST_ANIMAL_REJECTED',
  },
  ADOPTION: {
    created: 'ADOPTION_CREATED',
    approved: 'ADOPTION_APPROVED',
    rejected: 'ADOPTION_REJECTED',
  },
  MATING: {
    created: 'MATING_CREATED',
    approved: 'MATING_APPROVED',
    rejected: 'MATING_REJECTED',
  },
};

/** Domain-event names per kind + transition. IDs-only payloads. */
export const PUBLICATION_EVENTS: Record<
  PublicationKind,
  { created: string; approved: string; rejected: string }
> = {
  LOST: {
    created: 'animal.lost.created',
    approved: 'animal.lost.approved',
    rejected: 'animal.lost.rejected',
  },
  ADOPTION: {
    created: 'animal.adoption.created',
    approved: 'animal.adoption.approved',
    rejected: 'animal.adoption.rejected',
  },
  MATING: {
    created: 'animal.mating.created',
    approved: 'animal.mating.approved',
    rejected: 'animal.mating.rejected',
  },
};
