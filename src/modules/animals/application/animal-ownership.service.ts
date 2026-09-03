import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { AnimalPolicy } from '../domain/animal.policy.js';
import type { OwnershipRecordDTO } from '../domain/animal.types.js';
import type { AnimalRepository } from '../infrastructure/animal.repository.js';
import type { AnimalOwnershipRepository } from '../infrastructure/animal-ownership.repository.js';

export interface OwnershipActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Ownership transfer as a domain operation (spec §4): validate target → close
 * the current ownership → open a new one → audit → commit → publish. Never a
 * direct column update. The DB partial unique index
 * `uq_animal_current_ownership` is the ultimate guarantee that a transfer cannot
 * leave 0 or 2 current owners.
 */
export class AnimalOwnershipService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly animals: AnimalRepository,
    private readonly ownerships: AnimalOwnershipRepository,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-ownership-service' });
  }

  /**
   * `trx` lets a caller that already owns a transaction (e.g. the transfer-
   * request acceptance flow) compose this atomically instead of nesting a
   * second top-level transaction. Omit it for the normal owner-initiated,
   * instant-transfer call, which still opens its own. When `trx` is given,
   * the DB mutation runs inside it but the domain event is NOT published
   * here — the caller owns the commit and must publish
   * `animal.ownership.transferred` itself once its own transaction commits
   * (never publish before commit — a reader could see the event but not yet
   * the row).
   */
  async transfer(
    animalId: string,
    toUserId: string,
    actor: OwnershipActor,
    reason?: string,
    trx?: Knex.Transaction,
  ): Promise<OwnershipRecordDTO> {
    const animal = await this.animals.findById(animalId);
    if (!animal) throw new NotFoundError('Animal not found');
    AnimalPolicy.assertMutable(animal);

    const current = await this.ownerships.findCurrent(animalId);
    if (!current) throw new InternalError('animal has no current ownership record');

    const target = await this.users.getByIdOrNull(toUserId);
    AnimalPolicy.assertValidTransferTarget(
      target ? { id: target.id, status: target.status } : null,
      current.ownerUserId,
    );

    const previousOwnerUserId = current.ownerUserId;

    const run = async (tx: Knex.Transaction): Promise<void> => {
      const closed = await this.ownerships.endCurrent(animalId, new Date(), tx);
      if (closed !== 1) {
        // Someone else changed ownership between our read and this write.
        throw new ConflictError('The animal ownership changed concurrently; please retry');
      }

      await this.ownerships.create(
        {
          animalId,
          ownerUserId: toUserId,
          transferredBy: actor.actorUserId,
          transferReason: reason ?? null,
        },
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.ANIMAL_OWNERSHIP_TRANSFERRED,
          entityType: AuditEntityType.ANIMAL_OWNERSHIP,
          entityId: animalId,
          actorUserId: actor.actorUserId,
          metadata: {
            animalId,
            previousOwnerId: previousOwnerUserId,
            newOwnerId: toUserId,
            reason: reason ?? null,
          },
          context: actor.context,
        },
        tx,
      );
    };

    if (trx) {
      await run(trx);
    } else {
      await this.db.transaction(run);
      this.events.publish('animal.ownership.transferred', {
        animalId,
        previousOwnerUserId,
        newOwnerUserId: toUserId,
      });
    }

    const history = await this.ownerships.listForAnimal(animalId, trx);
    const currentRecord = history.find((h) => h.isCurrent);
    if (!currentRecord) throw new InternalError('transfer produced no current ownership');
    return currentRecord;
  }

  history(animalId: string): Promise<OwnershipRecordDTO[]> {
    return this.ownerships.listForAnimal(animalId);
  }
}
