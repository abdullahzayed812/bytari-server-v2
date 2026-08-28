import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { PublicationPolicy } from '../domain/publication.policy.js';
import { PUBLICATION_AUDIT_ACTIONS, PUBLICATION_EVENTS } from '../domain/publication.constants.js';
import {
  toPublicPublicationDTO,
  toPublicationDTO,
  type AnimalPublicationDTO,
  type CreatePublicationInput,
  type ListPublicationsFilter,
  type PublicListFilter,
  type PublicPublicationDTO,
} from '../domain/publication.types.js';
import type { AnimalPublicationRepository } from '../infrastructure/animal-publication.repository.js';

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
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-publication-service' });
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

  // --- moderation (ADMIN / ANIMAL system supervisor) ------------

  listForModeration(
    filter: ListPublicationsFilter,
  ): Promise<{ items: AnimalPublicationDTO[]; total: number }> {
    return this.publications
      .listForModeration(filter)
      .then(({ items, total }) => ({ items: items.map(toPublicationDTO), total }));
  }

  async getForModeration(publicationId: string): Promise<AnimalPublicationDTO> {
    const found = await this.publications.findById(publicationId);
    if (!found) throw new NotFoundError('Publication not found');
    return toPublicationDTO(found);
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
    });
    return toPublicationDTO(updated);
  }

  // --- public browse (any authenticated user) ------------------

  async listPublic(
    filter: PublicListFilter,
  ): Promise<{ items: PublicPublicationDTO[]; total: number }> {
    const { items, total } = await this.publications.listPublicApproved(filter);
    return { items: items.map(toPublicPublicationDTO), total };
  }

  async getPublic(publicationId: string): Promise<PublicPublicationDTO> {
    const found = await this.publications.findPublicApprovedById(publicationId);
    if (!found) throw new NotFoundError('Publication not found');
    return toPublicPublicationDTO(found);
  }
}
