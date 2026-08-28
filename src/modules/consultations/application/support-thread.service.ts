import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { AnimalOwnershipRepository } from '../../animals/infrastructure/animal-ownership.repository.js';
import type { MessageSource, ThreadSide } from '../domain/thread.constants.js';
import { ThreadPolicy } from '../domain/thread.policy.js';
import {
  toThreadDTO,
  toThreadMessageDTO,
  type ListThreadsFilter,
  type SupportThread,
  type ThreadDTO,
  type ThreadMessageDTO,
} from '../domain/thread.types.js';
import type { AiResponderPort } from './ai-responder.port.js';
import type { AiSettingsService } from './ai-settings.service.js';
import type { ThreadKindConfig } from './thread.config.js';
import type { ThreadRepository } from '../infrastructure/thread.repository.js';

export interface ThreadActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

const AUDIT_ENTITY: Record<string, string> = {
  CONSULTATION: AuditEntityType.CONSULTATION,
  INQUIRY: AuditEntityType.INQUIRY,
};

/**
 * The Consultation / Inquiry use cases. One instance per kind (see
 * {@link ThreadKindConfig}). Authorization:
 *
 *  - CREATOR  = `thread.createdByUserId === principal.userId` — always may read;
 *    may post only while OPEN and not sender-blocked.
 *  - RESPONDER = `authz.can(principal, <kind>.read)` — ADMIN override, or an
 *    ACTIVE CONSULTATION / INQUIRY system-supervisor domain assignment
 *    (`SUPERVISOR_DOMAIN_PERMISSIONS`). An INQUIRY supervisor therefore cannot
 *    touch a consultation and vice-versa.
 *
 * No relationship → `404` (ids never leak). Creator identity, responder
 * identity and message `source` are always derived here, never from the body.
 */
export class SupportThreadService {
  private readonly log: Logger;
  private readonly entityType: string;

  constructor(
    private readonly db: Knex,
    private readonly cfg: ThreadKindConfig,
    private readonly repo: ThreadRepository,
    private readonly aiSettings: AiSettingsService,
    private readonly aiResponder: AiResponderPort,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly animalOwnership: AnimalOwnershipRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: `${cfg.kind.toLowerCase()}-service` });
    this.entityType = AUDIT_ENTITY[cfg.kind] ?? cfg.kind;
  }

  // --- authorization ------------------------------------------------

  private async resolveSide(
    principal: AuthPrincipal,
    thread: SupportThread,
  ): Promise<ThreadSide | null> {
    if (thread.createdByUserId === principal.userId) return 'CREATOR';
    if (await this.authz.can(principal, this.cfg.perms.read)) {
      // ADMIN always; a domain supervisor must ALSO be an approved veterinarian
      // (docs 05 §5.18–5.19). The check is live, so revoking a supervisor's vet
      // approval removes their responder access immediately.
      if (this.authz.isAdmin(principal) || this.authz.isApprovedVeterinarian(principal)) {
        return 'RESPONDER';
      }
    }
    return null;
  }

  private async assertAccess(principal: AuthPrincipal, thread: SupportThread): Promise<ThreadSide> {
    const side = await this.resolveSide(principal, thread);
    if (!side) throw new NotFoundError(`${this.label()} not found`);
    return side;
  }

  /** Non-throwing — for the realtime subscription authorizer. */
  async canAccess(principal: AuthPrincipal, threadId: string): Promise<boolean> {
    const thread = await this.repo.findById(threadId);
    if (!thread) return false;
    return (await this.resolveSide(principal, thread)) !== null;
  }

  private label(): string {
    return this.cfg.kind === 'CONSULTATION' ? 'Consultation' : 'Inquiry';
  }

  private async load(threadId: string): Promise<SupportThread> {
    const thread = await this.repo.findById(threadId);
    if (!thread) throw new NotFoundError(`${this.label()} not found`);
    return thread;
  }

  // --- create -----------------------------------------------------

  async create(
    actor: ThreadActor,
    input: { body: string; animalId?: string | null },
  ): Promise<ThreadDTO> {
    if (this.cfg.createEligibility === 'APPROVED_VET') {
      this.authz.assertApprovedVeterinarian(actor.principal);
    }

    let animalId: string | null = null;
    if (this.cfg.hasAnimal && input.animalId) {
      const ownerId = await this.animalOwnership.currentOwnerUserId(input.animalId);
      if (ownerId !== actor.principal.userId) {
        throw new BadRequestError('animalId must reference an animal you currently own');
      }
      animalId = input.animalId;
    }

    const now = new Date();
    const thread = await this.db.transaction(async (tx) => {
      const created = await this.repo.create(
        { createdByUserId: actor.principal.userId, animalId },
        tx,
      );
      await this.repo.createMessage(
        {
          threadId: created.id,
          senderUserId: actor.principal.userId,
          source: 'USER',
          body: input.body,
        },
        tx,
      );
      await this.repo.touchLastMessageAt(created.id, now, tx);
      await this.audit.record(
        {
          action: this.cfg.auditActions.created,
          entityType: this.entityType,
          entityId: created.id,
          actorUserId: actor.principal.userId,
          metadata: { [`${this.cfg.kind.toLowerCase()}Id`]: created.id, animalId },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish(this.cfg.events.created, {
      [`${this.cfg.kind.toLowerCase()}Id`]: thread.id,
      createdByUserId: thread.createdByUserId,
    });

    // AI response — AFTER commit, never holding the transaction open.
    await this.maybeAiRespond(thread.id);

    const fresh = (await this.repo.findById(thread.id)) ?? thread;
    return toThreadDTO(this.cfg.kind, fresh);
  }

  /**
   * If AI is enabled for this kind, ask the abstraction for a reply and persist
   * it as an `AI` message in its own transaction. A provider error is logged
   * and swallowed — the original thread must stay intact.
   */
  private async maybeAiRespond(threadId: string): Promise<void> {
    let enabled = false;
    try {
      enabled = await this.aiSettings.isEnabled(this.cfg.aiSettingKey);
    } catch (err) {
      this.log.error({ err }, 'failed to read AI setting');
      return;
    }
    if (!enabled) return;

    let reply: string | null;
    try {
      const { items } = await this.repo.listMessages(threadId, { page: 1, pageSize: 100 });
      reply = await this.aiResponder.generate({
        kind: this.cfg.kind,
        threadId,
        messages: items.map((m) => ({ source: m.source, body: m.body })),
      });
    } catch (err) {
      this.log.warn({ err, threadId }, 'AI responder failed — thread left intact');
      return;
    }
    if (!reply) return;

    const now = new Date();
    const message = await this.db.transaction(async (tx) => {
      const created = await this.repo.createMessage(
        { threadId, senderUserId: null, source: 'AI', body: reply },
        tx,
      );
      await this.repo.markAiResponded(threadId, tx);
      await this.repo.touchLastMessageAt(threadId, now, tx);
      return created;
    });

    this.events.publish(this.cfg.events.message, {
      [this.cfg.parentIdField]: threadId,
      messageId: message.id,
      source: 'AI',
    });
  }

  // --- reads ----------------------------------------------------

  async listMine(
    userId: string,
    filter: Omit<ListThreadsFilter, 'createdByUserId'>,
  ): Promise<{ items: ThreadDTO[]; total: number }> {
    const { items, total } = await this.repo.list({ ...filter, createdByUserId: userId });
    return { items: items.map((t) => toThreadDTO(this.cfg.kind, t)), total };
  }

  async listAdmin(
    principal: AuthPrincipal,
    filter: ListThreadsFilter,
  ): Promise<{ items: ThreadDTO[]; total: number }> {
    await this.authz.assert(principal, this.cfg.perms.adminRead);
    const { items, total } = await this.repo.list(filter);
    return { items: items.map((t) => toThreadDTO(this.cfg.kind, t)), total };
  }

  async get(principal: AuthPrincipal, threadId: string): Promise<ThreadDTO> {
    const thread = await this.load(threadId);
    await this.assertAccess(principal, thread);
    return toThreadDTO(this.cfg.kind, thread);
  }

  async listMessages(
    principal: AuthPrincipal,
    threadId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: ThreadMessageDTO[]; total: number }> {
    const thread = await this.load(threadId);
    await this.assertAccess(principal, thread);
    const { items, total } = await this.repo.listMessages(thread.id, { page, pageSize });
    return { items: items.map(toThreadMessageDTO), total };
  }

  // --- writes -------------------------------------------------

  async sendMessage(actor: ThreadActor, threadId: string, body: string): Promise<ThreadMessageDTO> {
    const thread = await this.load(threadId);
    const side = await this.assertAccess(actor.principal, thread);

    let source: MessageSource;
    if (side === 'CREATOR') {
      ThreadPolicy.assertCreatorMayPost(thread);
      source = 'USER';
    } else {
      if (!(await this.authz.can(actor.principal, this.cfg.perms.respond))) {
        throw new ForbiddenError(`You cannot respond to this ${this.label().toLowerCase()}`, {
          code: ErrorCode.PERMISSION_DENIED,
        });
      }
      ThreadPolicy.assertResponderMayPost(thread);
      source = this.authz.isAdmin(actor.principal) ? 'ADMIN' : 'SUPERVISOR';
    }

    const now = new Date();
    const message = await this.db.transaction(async (tx) => {
      const created = await this.repo.createMessage(
        { threadId: thread.id, senderUserId: actor.principal.userId, source, body },
        tx,
      );
      await this.repo.touchLastMessageAt(thread.id, now, tx);
      return created;
    });

    this.events.publish(this.cfg.events.message, {
      [this.cfg.parentIdField]: thread.id,
      messageId: message.id,
      source,
    });
    return toThreadMessageDTO(message);
  }

  async close(actor: ThreadActor, threadId: string): Promise<ThreadDTO> {
    const thread = await this.load(threadId);
    await this.assertAccess(actor.principal, thread);
    if (!(await this.authz.can(actor.principal, this.cfg.perms.close))) {
      throw new ForbiddenError(`You cannot close this ${this.label().toLowerCase()}`, {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
    if (thread.status === 'CLOSED') return toThreadDTO(this.cfg.kind, thread); // idempotent

    const updated = await this.db.transaction(async (tx) => {
      const closed = await this.repo.close(thread.id, actor.principal.userId, tx);
      await this.audit.record(
        {
          action: this.cfg.auditActions.closed,
          entityType: this.entityType,
          entityId: thread.id,
          actorUserId: actor.principal.userId,
          metadata: { [this.cfg.parentIdField]: thread.id },
          context: actor.context,
        },
        tx,
      );
      return closed;
    });

    this.events.publish(this.cfg.events.closed, { [this.cfg.parentIdField]: thread.id });
    return toThreadDTO(this.cfg.kind, updated);
  }

  async setSenderBlocked(
    actor: ThreadActor,
    threadId: string,
    blocked: boolean,
  ): Promise<ThreadDTO> {
    const thread = await this.load(threadId);
    await this.assertAccess(actor.principal, thread);
    if (!(await this.authz.can(actor.principal, this.cfg.perms.respond))) {
      throw new ForbiddenError('Only a responder can block or unblock the sender', {
        code: ErrorCode.PERMISSION_DENIED,
      });
    }
    if ((thread.senderBlockedAt !== null) === blocked) {
      return toThreadDTO(this.cfg.kind, thread); // idempotent
    }

    const updated = await this.db.transaction(async (tx) => {
      const next = await this.repo.setSenderBlocked(thread.id, blocked, tx);
      await this.audit.record(
        {
          action: blocked ? this.cfg.auditActions.blocked : this.cfg.auditActions.unblocked,
          entityType: this.entityType,
          entityId: thread.id,
          actorUserId: actor.principal.userId,
          metadata: { [this.cfg.parentIdField]: thread.id },
          context: actor.context,
        },
        tx,
      );
      return next;
    });

    this.events.publish(blocked ? this.cfg.events.blocked : this.cfg.events.unblocked, {
      [this.cfg.parentIdField]: thread.id,
    });
    return toThreadDTO(this.cfg.kind, updated);
  }
}
