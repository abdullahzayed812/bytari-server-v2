import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { PublicationPolicy } from '../domain/publication.policy.js';
import {
  PUBLICATION_AUDIT_ACTIONS,
  PUBLICATION_EVENTS,
  RESOLUTIONS_BY_KIND,
  type PublicationResolution,
} from '../domain/publication.constants.js';
import {
  toModerationPublicationDTO,
  toMyPublicationDTO,
  toPublicPublicationDTO,
  toPublicationDTO,
  type AnimalPublicationDTO,
  type AnimalPublicationWithAnimal,
  type CreatePublicationInput,
  type ListPublicationsFilter,
  type MinePublicationsFilter,
  type ModerationPublicationDTO,
  type MyPublicationDTO,
  type PublicListFilter,
  type PublicPublicationDTO,
} from '../domain/publication.types.js';
import type {
  AdminUpdatePublicationData,
  AnimalPublicationRepository,
} from '../infrastructure/animal-publication.repository.js';
import type { PublicationKind } from '../domain/publication.constants.js';

/** Which editable fields belong to which kind — mirrors the per-kind create schemas. */
const EDITABLE_FIELDS_BY_KIND: Record<PublicationKind, readonly string[]> = {
  LOST: [
    'note',
    'contactName',
    'contactPhone',
    'lostDate',
    'lostTime',
    'lostGovernorate',
    'lostDistrict',
    'lostLocationDetail',
    'healthNotes',
  ],
  ADOPTION: [
    'note',
    'extraNotes',
    'contactName',
    'contactPhone',
    'city',
    'healthStatus',
    'vaccinationStatus',
    'isSterilized',
  ],
  MATING: [
    'note',
    'extraNotes',
    'contactName',
    'contactPhone',
    'city',
    'healthStatus',
    'vaccinationStatus',
  ],
};

export type AdminUpdatePublicationInput = Omit<AdminUpdatePublicationData, 'review'> & {
  status?: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
};

const IMAGE_URL_TTL_SECONDS = 3600;

export interface PublicationActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface AnimalRef {
  id: string;
  status: string;
  currentOwnerUserId: string | null;
}

/**
 * Lost / Adoption / Mating publications and their moderation. One reusable
 * PENDING → APPROVED / REJECTED lifecycle (docs 05 UC-005/006/007). The
 * publisher is always the animal's current owner (server-derived); approval is
 * ADMIN or a system supervisor for the ANIMAL domain (via `AuthorizationService`).
 */
export class AnimalPublicationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly publications: AnimalPublicationRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-publication-service' });
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

  /** A user's avatar key → client URL (same resolution rule as the gallery). */
  async resolveUserAvatar(key: string | null): Promise<string | null> {
    if (!key) return null;
    const [url] = await this.resolveGalleryUrls([key]);
    return url ?? null;
  }

  private async withResolvedGallery(
    item: AnimalPublicationWithAnimal,
  ): Promise<PublicPublicationDTO> {
    const dto = toPublicPublicationDTO(item);
    const galleryUrls = await this.resolveGalleryUrls(item.animal.galleryKeys);
    return { ...dto, animal: { ...dto.animal, galleryUrls } };
  }

  private async withResolvedGalleryModeration(
    item: AnimalPublicationWithAnimal,
  ): Promise<ModerationPublicationDTO> {
    const dto = toModerationPublicationDTO(item);
    const galleryUrls = await this.resolveGalleryUrls(item.animal.galleryKeys);
    return { ...dto, animal: { ...dto.animal, galleryUrls } };
  }

  private async withResolvedGalleryMine(
    item: AnimalPublicationWithAnimal,
  ): Promise<MyPublicationDTO> {
    const dto = toMyPublicationDTO(item);
    const galleryUrls = await this.resolveGalleryUrls(item.animal.galleryKeys);
    return { ...dto, animal: { ...dto.animal, galleryUrls } };
  }

  // --- owner ------------------------------------------------------

  async create(
    animal: AnimalRef,
    input: CreatePublicationInput,
    actor: PublicationActor,
  ): Promise<AnimalPublicationDTO> {
    PublicationPolicy.assertIsCurrentOwner(animal, actor.actorUserId);
    PublicationPolicy.assertAnimalActive(animal);

    const open = await this.publications.findOpen(animal.id, input.kind);
    if (open) {
      throw new ConflictError(`An open ${input.kind} publication already exists for this animal`, {
        code: ErrorCode.PUBLICATION_ALREADY_OPEN,
      });
    }

    const publication = await this.db.transaction(async (tx) => {
      const created = await this.publications.create(
        {
          animalId: animal.id,
          kind: input.kind,
          note: input.note ?? null,
          createdByUserId: actor.actorUserId,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          city: input.city ?? null,
          extraNotes: input.extraNotes ?? null,
          healthStatus: input.healthStatus ?? null,
          vaccinationStatus: input.vaccinationStatus ?? null,
          isSterilized: input.isSterilized ?? null,
          lostDate: input.lostDate ?? null,
          lostTime: input.lostTime ?? null,
          lostGovernorate: input.lostGovernorate ?? null,
          lostDistrict: input.lostDistrict ?? null,
          lostLocationDetail: input.lostLocationDetail ?? null,
          healthNotes: input.healthNotes ?? null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: PUBLICATION_AUDIT_ACTIONS[input.kind].created,
          entityType: AuditEntityType.ANIMAL_PUBLICATION,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { animalId: animal.id, publicationId: created.id, kind: input.kind },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish(PUBLICATION_EVENTS[input.kind].created, {
      publicationId: publication.id,
      animalId: animal.id,
      kind: input.kind,
      createdByUserId: actor.actorUserId,
    });
    return toPublicationDTO(publication);
  }

  async listForAnimal(
    animalId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: AnimalPublicationDTO[]; total: number }> {
    const { items, total } = await this.publications.listForAnimal(animalId, filter);
    return { items: items.map(toPublicationDTO), total };
  }

  async getForAnimal(animalId: string, publicationId: string): Promise<AnimalPublicationDTO> {
    const found = await this.publications.findByIdForAnimal(publicationId, animalId);
    if (!found) throw new NotFoundError('Publication not found');
    return toPublicationDTO(found);
  }

  /**
   * "My listings" — the caller's own publications of EVERY status, joined with
   * the animal summary. `createdByUserId` is the authenticated session's user,
   * never a client-supplied id.
   */
  async listMine(
    createdByUserId: string,
    filter: MinePublicationsFilter,
  ): Promise<{ items: MyPublicationDTO[]; total: number }> {
    const { items, total } = await this.publications.listMineWithAnimal(createdByUserId, filter);
    return {
      items: await Promise.all(items.map((i) => this.withResolvedGalleryMine(i))),
      total,
    };
  }

  /**
   * Delete a listing. Reachable only after the route's owner-or-moderator gate
   * (`requirePublicationOwnerOrModerator`): the creator, an ADMIN, or an ACTIVE
   * ANIMAL system-supervisor. Physical delete — viewer interactions cascade
   * (`animal_publication_interactions.publication_id ON DELETE CASCADE`).
   */
  async deletePublication(publicationId: string, actor: PublicationActor): Promise<void> {
    const existing = await this.publications.findById(publicationId);
    if (!existing) throw new NotFoundError('Publication not found');

    await this.db.transaction(async (tx) => {
      const removed = await this.publications.deleteById(publicationId, tx);
      if (removed === 0) throw new NotFoundError('Publication not found');
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_PUBLICATION_DELETED,
          entityType: AuditEntityType.ANIMAL_PUBLICATION,
          entityId: publicationId,
          actorUserId: actor.actorUserId,
          metadata: {
            animalId: existing.animalId,
            publicationId,
            kind: existing.kind,
            status: existing.status,
            byOwner: existing.createdByUserId === actor.actorUserId,
          },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('animal.publication.deleted', {
      publicationId,
      animalId: existing.animalId,
      kind: existing.kind,
    });
  }

  // --- moderation (ADMIN / ANIMAL system supervisor) ------------

  async listForModeration(
    filter: ListPublicationsFilter,
  ): Promise<{ items: ModerationPublicationDTO[]; total: number }> {
    const { items, total } = await this.publications.listForModeration(filter);
    return {
      items: await Promise.all(items.map((i) => this.withResolvedGalleryModeration(i))),
      total,
    };
  }

  async getForModeration(publicationId: string): Promise<ModerationPublicationDTO> {
    const found = await this.publications.findByIdWithAnimal(publicationId);
    if (!found) throw new NotFoundError('Publication not found');
    return this.withResolvedGalleryModeration(found);
  }

  async approve(publicationId: string, actor: PublicationActor): Promise<AnimalPublicationDTO> {
    return this.review(publicationId, 'APPROVED', null, actor);
  }

  async reject(
    publicationId: string,
    reason: string,
    actor: PublicationActor,
  ): Promise<AnimalPublicationDTO> {
    return this.review(publicationId, 'REJECTED', reason, actor);
  }

  private async review(
    publicationId: string,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    actor: PublicationActor,
  ): Promise<AnimalPublicationDTO> {
    const existing = await this.publications.findById(publicationId);
    if (!existing) throw new NotFoundError('Publication not found');
    PublicationPolicy.assertPending(existing);

    const kind = existing.kind;
    const action =
      status === 'APPROVED'
        ? PUBLICATION_AUDIT_ACTIONS[kind].approved
        : PUBLICATION_AUDIT_ACTIONS[kind].rejected;

    const updated = await this.db.transaction(async (tx) => {
      const record = await this.publications.review(
        publicationId,
        { status, reviewedByUserId: actor.actorUserId, rejectionReason: reason },
        tx,
      );
      await this.audit.record(
        {
          action,
          entityType: AuditEntityType.ANIMAL_PUBLICATION,
          entityId: publicationId,
          actorUserId: actor.actorUserId,
          metadata: {
            animalId: existing.animalId,
            publicationId,
            kind,
            ...(status === 'REJECTED' ? { reason } : {}),
          },
          context: actor.context,
        },
        tx,
      );
      return record;
    });

    const event =
      status === 'APPROVED' ? PUBLICATION_EVENTS[kind].approved : PUBLICATION_EVENTS[kind].rejected;
    this.events.publish(event, {
      publicationId,
      animalId: existing.animalId,
      kind,
      createdByUserId: existing.createdByUserId,
      actorUserId: actor.actorUserId,
    });
    return toPublicationDTO(updated);
  }

  /**
   * Moderator edit (ADMIN / ANIMAL supervisor via `animal.update`): corrects a
   * listing's fields and/or reverses a moderation decision (APPROVED ↔
   * REJECTED). Kind, animal and creator are immutable; fields foreign to the
   * kind are refused. A status change publishes the kind's approved/rejected
   * event (post-commit) so the owner is notified exactly as on first review.
   */
  async adminUpdate(
    publicationId: string,
    input: AdminUpdatePublicationInput,
    actor: PublicationActor,
  ): Promise<ModerationPublicationDTO> {
    const existing = await this.publications.findById(publicationId);
    if (!existing) throw new NotFoundError('Publication not found');

    const { status, rejectionReason, ...fields } = input;
    const allowed = EDITABLE_FIELDS_BY_KIND[existing.kind];
    const foreign = Object.keys(fields).filter(
      (k) => fields[k as keyof typeof fields] !== undefined && !allowed.includes(k),
    );
    if (foreign.length > 0) {
      throw new BadRequestError(`Fields not applicable to a ${existing.kind} listing`, {
        details: foreign.map((f) => ({
          path: `body.${f}`,
          message: 'not applicable to this kind',
        })),
      });
    }
    if (existing.kind === 'ADOPTION' && fields.note !== undefined && fields.note.length === 0) {
      throw new BadRequestError('note is required for an ADOPTION listing', {
        details: [{ path: 'body.note', message: 'required' }],
      });
    }

    const statusChanged = status !== undefined && status !== existing.status;
    if (statusChanged && status === 'REJECTED' && !rejectionReason) {
      throw new BadRequestError('rejectionReason is required to reject a listing', {
        details: [{ path: 'body.rejectionReason', message: 'required' }],
      });
    }
    const changedFields = Object.keys(fields).filter(
      (k) => fields[k as keyof typeof fields] !== undefined,
    );
    if (changedFields.length === 0 && !statusChanged) {
      return this.getForModeration(publicationId);
    }

    await this.db.transaction(async (tx) => {
      await this.publications.adminUpdate(
        publicationId,
        {
          ...fields,
          review: statusChanged
            ? {
                status,
                reviewedByUserId: actor.actorUserId,
                rejectionReason: status === 'REJECTED' ? (rejectionReason ?? null) : null,
              }
            : undefined,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.ANIMAL_PUBLICATION_UPDATED,
          entityType: AuditEntityType.ANIMAL_PUBLICATION,
          entityId: publicationId,
          actorUserId: actor.actorUserId,
          metadata: {
            animalId: existing.animalId,
            publicationId,
            kind: existing.kind,
            fields: changedFields,
            ...(statusChanged ? { fromStatus: existing.status, toStatus: status } : {}),
          },
          context: actor.context,
        },
        tx,
      );
    });

    if (statusChanged) {
      const kind = existing.kind;
      this.events.publish(
        status === 'APPROVED'
          ? PUBLICATION_EVENTS[kind].approved
          : PUBLICATION_EVENTS[kind].rejected,
        {
          publicationId,
          animalId: existing.animalId,
          kind,
          createdByUserId: existing.createdByUserId,
          actorUserId: actor.actorUserId,
        },
      );
    }
    return this.getForModeration(publicationId);
  }

  // --- public browse (any authenticated user) ------------------

  async listPublic(
    filter: PublicListFilter,
  ): Promise<{ items: PublicPublicationDTO[]; total: number }> {
    const { items, total } = await this.publications.listPublicApproved(filter);
    return { items: await Promise.all(items.map((i) => this.withResolvedGallery(i))), total };
  }

  async getPublic(publicationId: string): Promise<PublicPublicationDTO> {
    const found = await this.publications.findPublicApprovedById(publicationId);
    if (!found) throw new NotFoundError('Publication not found');
    return this.withResolvedGallery(found);
  }

  /** Internal helper for {@link PublicationInteractionService} — the publication owner + status + kind. */
  async loadOwnershipContext(publicationId: string): Promise<{
    id: string;
    createdByUserId: string;
    status: string;
    kind: string;
    resolution: PublicationResolution | null;
  } | null> {
    const found = await this.publications.findById(publicationId);
    if (!found) return null;
    return {
      id: found.id,
      createdByUserId: found.createdByUserId,
      status: found.status,
      kind: found.kind,
      resolution: found.resolution,
    };
  }

  /**
   * The listing OWNER records its outcome — LOST → FOUND, ADOPTION → ADOPTED,
   * any kind → CLOSED — or reopens it (`null`). Only an APPROVED listing has an
   * outcome; the moderation `status` is never touched. A resolved listing
   * leaves the public browse lists and stops accepting new requests.
   */
  async resolve(
    publicationId: string,
    resolution: PublicationResolution | null,
    actor: PublicationActor,
  ): Promise<PublicPublicationDTO> {
    const existing = await this.publications.findById(publicationId);
    // Not the owner → 404, so listing ids do not leak.
    if (!existing || existing.createdByUserId !== actor.actorUserId) {
      throw new NotFoundError('Publication not found');
    }
    if (existing.status !== 'APPROVED') {
      throw new ConflictError('Only a published (approved) listing can be marked resolved', {
        code: ErrorCode.PUBLICATION_NOT_APPROVED,
      });
    }
    if (resolution !== null && !RESOLUTIONS_BY_KIND[existing.kind].includes(resolution)) {
      throw new BadRequestError(
        `"${resolution}" is not a valid outcome for a ${existing.kind} listing`,
        {
          code: ErrorCode.VALIDATION_ERROR,
        },
      );
    }
    if (existing.resolution !== resolution) {
      await this.db.transaction(async (tx) => {
        await this.publications.setResolution(publicationId, resolution, actor.actorUserId, tx);
        await this.audit.record(
          {
            action: AuditAction.ANIMAL_PUBLICATION_RESOLVED,
            entityType: AuditEntityType.ANIMAL_PUBLICATION,
            entityId: publicationId,
            actorUserId: actor.actorUserId,
            metadata: {
              publicationId,
              kind: existing.kind,
              from: existing.resolution,
              to: resolution,
            },
            context: actor.context,
          },
          tx,
        );
      });
      this.events.publish('animal.publication.resolved', {
        publicationId,
        kind: existing.kind,
        resolution,
        ownerUserId: existing.createdByUserId,
      });
    }
    const fresh = await this.publications.findByIdWithAnimal(publicationId);
    if (!fresh) throw new NotFoundError('Publication not found');
    return this.withResolvedGallery(fresh);
  }
}
