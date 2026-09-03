import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { UserService } from '../../users/user.service.js';
import { AnimalPolicy } from '../domain/animal.policy.js';
import { TransferRequestPolicy } from '../domain/transfer-request.policy.js';
import type {
  AnimalTransferRequest,
  AnimalTransferRequestDTO,
  CreateTransferRequestInput,
} from '../domain/transfer-request.types.js';
import type { AnimalTransferRequestRepository } from '../infrastructure/animal-transfer-request.repository.js';
import type { AnimalOwnershipService } from './animal-ownership.service.js';

export interface TransferRequestActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface TransferRequestAnimalRef {
  id: string;
  status: string;
  currentOwnerUserId: string | null;
}

export interface TransferRequestListFilter {
  page: number;
  pageSize: number;
}

/**
 * Request/acceptance ownership transfer ("نقل ملكية بموافقة"): the current
 * owner proposes a transfer; the recipient must ACCEPT before ownership
 * actually moves (via {@link AnimalOwnershipService.transfer}, composed into
 * this service's own transaction). REJECT / CANCEL leave ownership untouched.
 */
export class AnimalTransferRequestService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly requests: AnimalTransferRequestRepository,
    private readonly ownership: AnimalOwnershipService,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'animal-transfer-request-service' });
  }

  // --- create (current owner only — enforced by the route middleware) ---

  async create(
    animal: TransferRequestAnimalRef,
    input: CreateTransferRequestInput,
    actor: TransferRequestActor,
  ): Promise<AnimalTransferRequestDTO> {
    if (animal.status !== 'ACTIVE') {
      throw new ConflictError('The animal is deactivated and cannot be transferred', {
        code: ErrorCode.ANIMAL_NOT_ACTIVE,
      });
    }

    const target = await this.users.getByIdOrNull(input.toUserId);
    AnimalPolicy.assertValidTransferTarget(
      target ? { id: target.id, status: target.status } : null,
      actor.actorUserId,
    );

    const open = await this.requests.findOpenForAnimal(animal.id);
    if (open) {
      throw new ConflictError('An open transfer request already exists for this animal', {
        code: ErrorCode.TRANSFER_REQUEST_ALREADY_OPEN,
      });
    }

    const created = await this.requests.create({
      animalId: animal.id,
      fromUserId: actor.actorUserId,
      toUserId: input.toUserId,
      reason: input.reason?.trim() || null,
    });

    await this.audit.record({
      action: AuditAction.ANIMAL_TRANSFER_REQUESTED,
      entityType: AuditEntityType.ANIMAL_OWNERSHIP,
      entityId: animal.id,
      actorUserId: actor.actorUserId,
      metadata: { animalId: animal.id, toUserId: input.toUserId },
      context: actor.context,
    });

    this.events.publish('animal.transfer.requested', {
      requestId: created.id,
      animalId: animal.id,
      fromUserId: actor.actorUserId,
      toUserId: input.toUserId,
    });

    return this.mustGetDTO(created.id);
  }

  // --- reads ------------------------------------------------------

  async listSent(
    userId: string,
    filter: TransferRequestListFilter,
  ): Promise<{ items: AnimalTransferRequestDTO[]; total: number }> {
    return this.requests.listSent(userId, filter);
  }

  async listReceived(
    userId: string,
    filter: TransferRequestListFilter,
  ): Promise<{ items: AnimalTransferRequestDTO[]; total: number }> {
    return this.requests.listReceived(userId, filter);
  }

  /** Only the sender or the recipient may view one request — 404 otherwise (hides existence). */
  async getForActor(id: string, actor: TransferRequestActor): Promise<AnimalTransferRequestDTO> {
    const dto = await this.requests.findDTOById(id);
    if (!dto || (dto.fromUser.id !== actor.actorUserId && dto.toUser.id !== actor.actorUserId)) {
      throw new NotFoundError('Transfer request not found');
    }
    return dto;
  }

  // --- responses ----------------------------------------------------

  /** Recipient accepts → the animal's ownership actually transfers, atomically. */
  async accept(id: string, actor: TransferRequestActor): Promise<AnimalTransferRequestDTO> {
    const request = await this.loadForResponse(id, actor.actorUserId);
    TransferRequestPolicy.assertRecipient(request, actor.actorUserId);
    TransferRequestPolicy.assertPending(request);

    await this.db.transaction(async (tx) => {
      const resolved = await this.requests.resolve(id, 'ACCEPTED', null, tx);
      if (!resolved) {
        throw new ConflictError('This transfer request has already been resolved', {
          code: ErrorCode.TRANSFER_REQUEST_NOT_PENDING,
        });
      }

      // The sender is recorded as the one who "transferred it away" — matches
      // the instant-transfer flow's semantics of `transferredBy`.
      await this.ownership.transfer(
        request.animalId,
        request.toUserId,
        { actorUserId: request.fromUserId, context: actor.context },
        request.reason ?? undefined,
        tx,
      );

      await this.audit.record(
        {
          action: AuditAction.ANIMAL_TRANSFER_ACCEPTED,
          entityType: AuditEntityType.ANIMAL_OWNERSHIP,
          entityId: request.animalId,
          actorUserId: actor.actorUserId,
          metadata: { animalId: request.animalId, requestId: id },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('animal.ownership.transferred', {
      animalId: request.animalId,
      previousOwnerUserId: request.fromUserId,
      newOwnerUserId: request.toUserId,
    });
    this.events.publish('animal.transfer.accepted', {
      requestId: id,
      animalId: request.animalId,
      fromUserId: request.fromUserId,
      toUserId: request.toUserId,
    });

    return this.mustGetDTO(id);
  }

  /** Recipient declines — no ownership change. */
  async reject(
    id: string,
    reason: string | undefined,
    actor: TransferRequestActor,
  ): Promise<AnimalTransferRequestDTO> {
    const request = await this.loadForResponse(id, actor.actorUserId);
    TransferRequestPolicy.assertRecipient(request, actor.actorUserId);
    TransferRequestPolicy.assertPending(request);

    const resolved = await this.requests.resolve(id, 'REJECTED', reason?.trim() || null);
    if (!resolved) {
      throw new ConflictError('This transfer request has already been resolved', {
        code: ErrorCode.TRANSFER_REQUEST_NOT_PENDING,
      });
    }

    await this.audit.record({
      action: AuditAction.ANIMAL_TRANSFER_REJECTED,
      entityType: AuditEntityType.ANIMAL_OWNERSHIP,
      entityId: request.animalId,
      actorUserId: actor.actorUserId,
      metadata: { animalId: request.animalId, requestId: id },
      context: actor.context,
    });

    this.events.publish('animal.transfer.rejected', {
      requestId: id,
      animalId: request.animalId,
      fromUserId: request.fromUserId,
      toUserId: request.toUserId,
    });

    return this.mustGetDTO(id);
  }

  /** Sender withdraws their own request before it is answered. */
  async cancel(id: string, actor: TransferRequestActor): Promise<AnimalTransferRequestDTO> {
    const request = await this.loadForResponse(id, actor.actorUserId);
    TransferRequestPolicy.assertSender(request, actor.actorUserId);
    TransferRequestPolicy.assertPending(request);

    const resolved = await this.requests.resolve(id, 'CANCELLED', null);
    if (!resolved) {
      throw new ConflictError('This transfer request has already been resolved', {
        code: ErrorCode.TRANSFER_REQUEST_NOT_PENDING,
      });
    }

    await this.audit.record({
      action: AuditAction.ANIMAL_TRANSFER_CANCELLED,
      entityType: AuditEntityType.ANIMAL_OWNERSHIP,
      entityId: request.animalId,
      actorUserId: actor.actorUserId,
      metadata: { animalId: request.animalId, requestId: id },
      context: actor.context,
    });

    return this.mustGetDTO(id);
  }

  // --- helpers ------------------------------------------------------

  /** Load a request for a respond-style action — 404 unless the actor is the sender or recipient. */
  private async loadForResponse(id: string, actorUserId: string): Promise<AnimalTransferRequest> {
    const request = await this.requests.findById(id);
    if (!request || (request.fromUserId !== actorUserId && request.toUserId !== actorUserId)) {
      throw new NotFoundError('Transfer request not found');
    }
    return request;
  }

  private async mustGetDTO(id: string): Promise<AnimalTransferRequestDTO> {
    const dto = await this.requests.findDTOById(id);
    if (!dto) throw new NotFoundError('Transfer request not found');
    return dto;
  }
}
