import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { AnimalPolicy } from '../domain/animal.policy.js';
import {
  toAnimalDTO,
  type AnimalDTO,
  type CreateAnimalInput,
  type ListAnimalsFilter,
  type UpdateAnimalInput,
} from '../domain/animal.types.js';
import type { AnimalRepository } from '../infrastructure/animal.repository.js';
import type { AnimalOwnershipRepository } from '../infrastructure/animal-ownership.repository.js';

export interface AnimalActor {
  actorUserId: string;
  context?: AuditContext;
}

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Hard ceiling per photo (5 MiB — mirrors the user avatar / organization image limit). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;
/** The Lost / Adoption / Mating listing forms invite "more than one photo". */
const MAX_GALLERY_IMAGES = 8;

/**
 * Animal Core lifecycle: create (creator becomes owner), read, list (owner
 * scoped), update, deactivate, plus the photo gallery (presigned R2 upload,
 * same pattern as the organization logo/gallery). Ownership transfer lives in
 * {@link AnimalOwnershipService}.
 */
export class AnimalService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly animals: AnimalRepository,
    private readonly ownerships: AnimalOwnershipRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-service' });
  }

  private async resolveGalleryUrls(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const urls = await Promise.all(
      keys.map(
        async (key) =>
          this.storage.getPublicUrl(key) ??
          (await this.storage.getSignedUrl(key, {
            operation: 'get',
            expiresIn: IMAGE_URL_TTL_SECONDS,
          })),
      ),
    );
    return urls.filter((u): u is string => u !== null);
  }

  async create(input: CreateAnimalInput, actor: AnimalActor): Promise<AnimalDTO> {
    const animal = await this.db.transaction(async (tx) => {
      const created = await this.animals.create(
        {
          name: input.name,
          species: input.species,
          breed: input.breed ?? null,
          sex: input.sex ?? 'UNKNOWN',
          dateOfBirth: input.dateOfBirth ?? null,
          notes: input.notes ?? null,
          createdBy: actor.actorUserId,
          color: input.color ?? null,
          distinguishingFeatures: input.distinguishingFeatures ?? null,
          ageEstimate: input.ageEstimate ?? null,
        },
        tx,
      );

      // The creator is ALWAYS the initial owner — never taken from the client.
      await this.ownerships.create(
        {
          animalId: created.id,
          ownerUserId: actor.actorUserId,
          transferredBy: actor.actorUserId,
          transferReason: 'initial ownership',
        },
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.ANIMAL_CREATED,
          entityType: AuditEntityType.ANIMAL,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { name: created.name, species: created.species },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('animal.created', {
      animalId: animal.id,
      ownerUserId: actor.actorUserId,
    });

    return toAnimalDTO(animal, actor.actorUserId);
  }

  async getDTOById(animalId: string): Promise<AnimalDTO> {
    const animal = await this.animals.findById(animalId);
    if (!animal) throw new NotFoundError('Animal not found');
    const owner = await this.ownerships.currentOwnerUserId(animalId);
    const galleryUrls = await this.resolveGalleryUrls(animal.galleryKeys);
    return toAnimalDTO(animal, owner, galleryUrls);
  }

  async list(
    ownerUserId: string,
    filter: ListAnimalsFilter,
  ): Promise<{ items: AnimalDTO[]; total: number }> {
    const { items, total } = await this.animals.listForOwner(ownerUserId, filter);
    // Current owner of every row is `ownerUserId` by construction of the query.
    const dtos = await Promise.all(
      items.map(async (a) => toAnimalDTO(a, ownerUserId, await this.resolveGalleryUrls(a.galleryKeys))),
    );
    return { items: dtos, total };
  }

  async update(animalId: string, patch: UpdateAnimalInput, actor: AnimalActor): Promise<AnimalDTO> {
    const existing = await this.animals.findById(animalId);
    if (!existing) throw new NotFoundError('Animal not found');
    AnimalPolicy.assertMutable(existing);

    const updated = await this.db.transaction(async (tx) => {
      const animal = await this.animals.update(animalId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_UPDATED,
          entityType: AuditEntityType.ANIMAL,
          entityId: animalId,
          actorUserId: actor.actorUserId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return animal;
    });

    this.events.publish('animal.updated', { animalId });
    const owner = await this.ownerships.currentOwnerUserId(animalId);
    const galleryUrls = await this.resolveGalleryUrls(updated.galleryKeys);
    return toAnimalDTO(updated, owner, galleryUrls);
  }

  /** Soft delete: DEACTIVATED status. Ownership records are left intact. Idempotent. */
  async deactivate(animalId: string, actor: AnimalActor): Promise<AnimalDTO> {
    const existing = await this.animals.findById(animalId);
    if (!existing) throw new NotFoundError('Animal not found');

    const owner = await this.ownerships.currentOwnerUserId(animalId);
    if (existing.status === 'DEACTIVATED') {
      return toAnimalDTO(existing, owner, await this.resolveGalleryUrls(existing.galleryKeys));
    }

    const updated = await this.db.transaction(async (tx) => {
      const animal = await this.animals.setStatus(animalId, 'DEACTIVATED', tx);
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_DEACTIVATED,
          entityType: AuditEntityType.ANIMAL,
          entityId: animalId,
          actorUserId: actor.actorUserId,
          metadata: {},
          context: actor.context,
        },
        tx,
      );
      return animal;
    });

    this.events.publish('animal.deactivated', { animalId });
    return toAnimalDTO(updated, owner, await this.resolveGalleryUrls(updated.galleryKeys));
  }

  // --- gallery (presigned direct-to-storage upload, N photos) -------

  async requestGalleryUploadUrl(
    animalId: string,
    actor: AnimalActor,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    const animal = await this.getOwned(animalId, actor.actorUserId);

    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`photo exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a photo`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    if (animal.galleryKeys.length >= MAX_GALLERY_IMAGES) {
      throw new BadRequestError(`the gallery already has the maximum of ${MAX_GALLERY_IMAGES} photos`, {
        code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
      });
    }

    const storageKey = buildObjectKey(StoragePrefix.animalImages, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: IMAGE_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });

    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: IMAGE_UPLOAD_URL_TTL_SECONDS,
    };
  }

  async addGalleryImage(
    animalId: string,
    actor: AnimalActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<AnimalDTO> {
    const animal = await this.getOwned(animalId, actor.actorUserId);
    if (!input.storageKey.startsWith(`${StoragePrefix.animalImages}/`)) {
      throw new ConflictError('storage key does not belong to animal uploads', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }

    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    if (head.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(realMime as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    if (animal.galleryKeys.length >= MAX_GALLERY_IMAGES) {
      throw new BadRequestError(`the gallery already has the maximum of ${MAX_GALLERY_IMAGES} photos`, {
        code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
      });
    }

    const galleryKeys = [...animal.galleryKeys, input.storageKey];
    const updated = await this.db.transaction(async (tx) => {
      const a = await this.animals.update(animalId, { galleryKeys }, tx);
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_GALLERY_UPDATED,
          entityType: AuditEntityType.ANIMAL,
          entityId: animalId,
          actorUserId: actor.actorUserId,
          metadata: { animalId, sizeBytes: head.size, photoCount: galleryKeys.length },
          context: actor.context,
        },
        tx,
      );
      return a;
    });

    const owner = await this.ownerships.currentOwnerUserId(animalId);
    return toAnimalDTO(updated, owner, await this.resolveGalleryUrls(updated.galleryKeys));
  }

  async removeGalleryImage(
    animalId: string,
    actor: AnimalActor,
    storageKey: string,
  ): Promise<AnimalDTO> {
    const animal = await this.getOwned(animalId, actor.actorUserId);
    const galleryKeys = animal.galleryKeys.filter((k) => k !== storageKey);
    if (galleryKeys.length === animal.galleryKeys.length) {
      throw new NotFoundError('Gallery photo not found');
    }

    const updated = await this.db.transaction(async (tx) => {
      const a = await this.animals.update(animalId, { galleryKeys }, tx);
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_GALLERY_UPDATED,
          entityType: AuditEntityType.ANIMAL,
          entityId: animalId,
          actorUserId: actor.actorUserId,
          metadata: { animalId, photoCount: galleryKeys.length },
          context: actor.context,
        },
        tx,
      );
      return a;
    });

    try {
      await this.storage.delete(storageKey);
    } catch (err) {
      this.log.error({ err, animalId }, 'failed to delete removed animal photo — needs a sweep');
    }

    const owner = await this.ownerships.currentOwnerUserId(animalId);
    return toAnimalDTO(updated, owner, await this.resolveGalleryUrls(updated.galleryKeys));
  }

  /** Internal helper used by the middleware for authorization context. */
  async loadContext(
    animalId: string,
  ): Promise<{ id: string; status: string; currentOwnerUserId: string | null } | null> {
    const animal = await this.animals.findById(animalId);
    if (!animal) return null;
    const currentOwnerUserId = await this.ownerships.currentOwnerUserId(animalId);
    if (!currentOwnerUserId) throw new InternalError('animal has no current ownership record');
    return { id: animal.id, status: animal.status, currentOwnerUserId };
  }

  /** The animal, asserting `actorUserId` is its current owner — 404 otherwise (resource-hiding, §Phase 4). */
  private async getOwned(
    animalId: string,
    actorUserId: string,
  ): Promise<{ galleryKeys: string[] }> {
    const ctx = await this.loadContext(animalId);
    if (!ctx || ctx.currentOwnerUserId !== actorUserId) throw new NotFoundError('Animal not found');
    const animal = await this.animals.findById(animalId);
    if (!animal) throw new NotFoundError('Animal not found');
    return { galleryKeys: animal.galleryKeys };
  }
}
