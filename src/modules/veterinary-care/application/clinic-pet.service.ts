import type { ObjectStorage } from '../../../infra/storage/index.js';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { normalizePublicCode } from '../../animals/domain/public-code.js';
import type { AnimalRepository } from '../../animals/infrastructure/animal.repository.js';
import type { Animal } from '../../animals/domain/animal.types.js';
import type {
  ClinicPetActivity,
  ClinicPetListItem,
  ClinicPetRepository,
} from '../infrastructure/clinic-pet.repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One row of the clinic's Recent / All Pets list. */
export interface ClinicPetDTO {
  animalId: string;
  publicCode: string;
  animal: {
    name: string;
    species: string;
    status: string;
    breed: string | null;
    photoUrl: string | null;
  };
  ownerName: string | null;
  firstActivityAt: string;
  lastActivityAt: string;
}

/** `GET /organizations/:id/clinic-pets/lookup` — just enough to confirm and open the pet. */
export interface ClinicPetLookupDTO {
  animalId: string;
  publicCode: string;
  name: string;
  species: string;
  breed: string | null;
  photoUrl: string | null;
  /** True when this clinic already has its own records for the pet. */
  workedWith: boolean;
}

/**
 * Clinic ↔ pet relationship, record-derived (there is no link / grant).
 *
 *  - A pet exists independently of clinics. Any operational clinic opens it
 *    by its short public ID (or the legacy UUID QR) — that is the owner's
 *    consent: the owner shows / reads out the code at the clinic.
 *  - What a clinic "has" for a pet is exactly the rows it authored; its
 *    Recent / All Pets list is built from those rows ({@link ClinicPetRepository}).
 */
export class ClinicPetService {
  constructor(
    private readonly pets: ClinicPetRepository,
    private readonly animals: AnimalRepository,
    private readonly audit: AuditService,
    /** Resolves each pet's first photo. */
    private readonly storage: ObjectStorage | null = null,
  ) {}

  private async photoUrl(key: string | null): Promise<string | null> {
    if (!key || !this.storage) return null;
    return (
      this.storage.getPublicUrl(key) ??
      (await this.storage.getSignedUrl(key, { operation: 'get', expiresIn: 3600 }))
    );
  }

  activityFor(organizationId: string, animalId: string): Promise<ClinicPetActivity | null> {
    return this.pets.activityFor(organizationId, animalId);
  }

  countForClinic(organizationId: string): Promise<number> {
    return this.pets.countForClinic(organizationId);
  }

  async list(
    organizationId: string,
    filter: { page: number; pageSize: number; search?: string },
  ): Promise<{ items: ClinicPetDTO[]; total: number }> {
    const { items, total } = await this.pets.listForClinic(organizationId, filter);
    return {
      items: await Promise.all(items.map((it) => this.toDTO(it))),
      total,
    };
  }

  /**
   * Resolve a typed / scanned code to a registered pet. Accepts the short
   * public ID (any case, with or without the dash) or a full UUID (QR codes
   * printed before the short ID existed). Listing-only subjects and unknown
   * codes are the same 404, so nothing is revealed about either.
   */
  async lookup(
    organizationId: string,
    rawCode: string,
    actor: { actorUserId: string; context?: AuditContext },
  ): Promise<ClinicPetLookupDTO> {
    const input = rawCode.trim();
    // The QR may carry a link — pull the code / UUID out of it.
    const uuid = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    const code = uuid ? null : normalizePublicCode(input.split(/[/?=#]/).pop() ?? input);
    let animal: Animal | null = null;
    if (uuid && UUID_RE.test(uuid)) animal = await this.animals.findById(uuid.toLowerCase());
    else if (code) animal = await this.animals.findByPublicCode(code);
    if (!animal || animal.listingOnly) throw new NotFoundError('Animal not found');

    const activity = await this.pets.activityFor(organizationId, animal.id);
    await this.audit.record({
      action: AuditAction.CLINIC_PET_LOOKED_UP,
      entityType: AuditEntityType.ANIMAL,
      entityId: animal.id,
      actorUserId: actor.actorUserId,
      metadata: { organizationId, animalId: animal.id, via: uuid ? 'UUID' : 'PUBLIC_CODE' },
      context: actor.context,
    });
    return {
      animalId: animal.id,
      publicCode: animal.publicCode,
      name: animal.name,
      species: animal.species,
      breed: animal.breed,
      photoUrl: await this.photoUrl(animal.galleryKeys[0] ?? null),
      workedWith: activity !== null,
    };
  }

  private async toDTO(it: ClinicPetListItem): Promise<ClinicPetDTO> {
    return {
      animalId: it.animalId,
      publicCode: it.publicCode,
      animal: {
        name: it.animalName,
        species: it.animalSpecies,
        status: it.animalStatus,
        breed: it.animalBreed,
        photoUrl: await this.photoUrl(it.animalPhotoKey),
      },
      ownerName: it.ownerName,
      firstActivityAt: it.firstActivityAt,
      lastActivityAt: it.lastActivityAt,
    };
  }
}
