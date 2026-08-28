import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
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

/**
 * Animal Core lifecycle: create (creator becomes owner), read, list (owner
 * scoped), update, deactivate. Ownership transfer lives in
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
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-service' });
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
    return toAnimalDTO(animal, owner);
  }

  async list(
    ownerUserId: string,
    filter: ListAnimalsFilter,
  ): Promise<{ items: AnimalDTO[]; total: number }> {
    const { items, total } = await this.animals.listForOwner(ownerUserId, filter);
    // Current owner of every row is `ownerUserId` by construction of the query.
    return { items: items.map((a) => toAnimalDTO(a, ownerUserId)), total };
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
    return toAnimalDTO(updated, owner);
  }

  /** Soft delete: DEACTIVATED status. Ownership records are left intact. Idempotent. */
  async deactivate(animalId: string, actor: AnimalActor): Promise<AnimalDTO> {
    const existing = await this.animals.findById(animalId);
    if (!existing) throw new NotFoundError('Animal not found');

    const owner = await this.ownerships.currentOwnerUserId(animalId);
    if (existing.status === 'DEACTIVATED') return toAnimalDTO(existing, owner);

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
    return toAnimalDTO(updated, owner);
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
}
