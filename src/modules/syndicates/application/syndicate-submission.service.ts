import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { UserService } from '../../users/user.service.js';
import {
  SyndicateAuditAction,
  SyndicateAuditEntity,
  SyndicateEvent,
} from '../domain/syndicate.constants.js';
import { SyndicatePolicy } from '../domain/syndicate.policy.js';
import type {
  CreateSubmissionInput,
  MySubmissionListFilter,
  SubmissionListFilter,
  SyndicateSubmission,
  SyndicateSubmissionDTO,
} from '../domain/syndicate.types.js';
import type { SyndicateSubmissionRepository } from '../infrastructure/syndicate-submission.repository.js';
import type { SyndicateMedia } from './syndicate-media.js';
import type { SyndicateService } from './syndicate.service.js';

export interface SyndicateActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

/**
 * Port onto the notification read-state: clears one officer's "new
 * submission" notifications for a submission once they open / act on it —
 * this is what decrements the syndicate card's unread counters.
 */
export interface EntityNotificationReads {
  markReadForEntity(userId: string, entityType: string, entityId: string): Promise<void>;
}

/**
 * "طلبات" (kind=REQUEST, e.g. ID issuance/renewal, office-license
 * issuance/renewal) + "استفسارات" (kind=INQUIRY, free-text) submitted to a
 * syndicate. One shared entity — same shape, same status lifecycle
 * (PENDING → RESPONDED / CLOSED) — mirroring how `vet-courses` uses one
 * entity with a `type` discriminator instead of two near-identical modules.
 */
export class SyndicateSubmissionService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly submissions: SyndicateSubmissionRepository,
    private readonly syndicates: SyndicateService,
    private readonly media: SyndicateMedia,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
    private readonly notificationReads: EntityNotificationReads | null = null,
  ) {
    this.log = logger.child({ component: 'syndicate-submission-service' });
  }

  /** Best-effort — a read-state failure never fails the request itself. */
  private async markSeen(userId: string, submissionId: string): Promise<void> {
    if (!this.notificationReads) return;
    try {
      await this.notificationReads.markReadForEntity(userId, 'SYNDICATE_SUBMISSION', submissionId);
    } catch (err) {
      this.log.warn({ err, submissionId }, 'failed to mark submission notifications read');
    }
  }

  private async toDTO(submission: SyndicateSubmission): Promise<SyndicateSubmissionDTO> {
    const [submitter, org] = await Promise.all([
      this.users.getById(submission.submittedByUserId),
      this.syndicates.loadOrganizationContext(submission.organizationId),
    ]);
    const { attachmentStorageKeys, ...rest } = submission;
    return {
      ...rest,
      attachmentUrls: await this.media.resolveUrls(attachmentStorageKeys),
      submittedBy: {
        id: submitter.id,
        firstName: submitter.firstName,
        lastName: submitter.lastName,
      },
      syndicateName: org?.name ?? '',
    };
  }

  // --- submit (any authenticated user) --------------------------------

  async create(
    organizationId: string,
    input: CreateSubmissionInput,
    actor: SyndicateActor,
  ): Promise<SyndicateSubmissionDTO> {
    const org = await this.syndicates.loadOrganizationContext(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');
    const attachmentStorageKeys = await this.media.validateAttachmentKeys(
      input.attachmentStorageKeys,
    );

    const created = await this.db.transaction(async (tx) => {
      const s = await this.submissions.create(
        organizationId,
        actor.principal.userId,
        { ...input, attachmentStorageKeys },
        tx,
      );
      await this.audit.record(
        {
          action: SyndicateAuditAction.SUBMISSION_CREATED,
          entityType: SyndicateAuditEntity.SUBMISSION,
          entityId: s.id,
          actorUserId: actor.principal.userId,
          metadata: { organizationId, kind: s.kind, requestType: s.requestType },
          context: actor.context,
        },
        tx,
      );
      return s;
    });

    this.events.publish(SyndicateEvent.SUBMISSION_CREATED, {
      submissionId: created.id,
      organizationId,
      kind: created.kind,
      submittedByUserId: actor.principal.userId,
    });
    return this.toDTO(created);
  }

  // --- reads -----------------------------------------------------

  async listForOrganization(
    organizationId: string,
    filter: SubmissionListFilter,
  ): Promise<{ items: SyndicateSubmissionDTO[]; total: number }> {
    const { items, total } = await this.submissions.listForOrganization(organizationId, filter);
    return { items: await Promise.all(items.map((s) => this.toDTO(s))), total };
  }

  /** The caller's own submissions across every syndicate ("متابعة الطلب من خلال حسابك"). */
  async listMine(
    actor: SyndicateActor,
    filter: MySubmissionListFilter,
  ): Promise<{ items: SyndicateSubmissionDTO[]; total: number }> {
    const { items, total } = await this.submissions.listMine(actor.principal.userId, filter);
    return { items: await Promise.all(items.map((s) => this.toDTO(s))), total };
  }

  /**
   * `authorizedOrganizationId` — set when the caller came through the
   * org-scoped route (`authorizeOrg('syndicate.submission.read')` on THAT
   * syndicate): the submission must belong to it, so an officer of one
   * syndicate can never read another syndicate's submission by id.
   */
  async getForActor(
    id: string,
    actor: SyndicateActor,
    authorizedOrganizationId: string | null,
  ): Promise<SyndicateSubmissionDTO> {
    const existing = await this.submissions.findById(id);
    if (!existing) throw new NotFoundError('Submission not found');
    const isOrgAuthorized =
      authorizedOrganizationId !== null && existing.organizationId === authorizedOrganizationId;
    if (existing.submittedByUserId !== actor.principal.userId && !isOrgAuthorized) {
      throw new NotFoundError('Submission not found');
    }
    if (isOrgAuthorized) await this.markSeen(actor.principal.userId, id);
    return this.toDTO(existing);
  }

  // --- responder actions (syndicate.submission.respond, org-scoped) -----

  async respond(
    organizationId: string,
    id: string,
    responseText: string,
    actor: SyndicateActor,
  ): Promise<SyndicateSubmissionDTO> {
    const existing = await this.submissions.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Submission not found');
    }
    SyndicatePolicy.assertPending(existing);

    const updated = await this.db.transaction(async (tx) => {
      const s = await this.submissions.update(
        id,
        {
          status: 'RESPONDED',
          responseText,
          respondedByUserId: actor.principal.userId,
          respondedAt: new Date(),
        },
        tx,
      );
      await this.audit.record(
        {
          action: SyndicateAuditAction.SUBMISSION_RESPONDED,
          entityType: SyndicateAuditEntity.SUBMISSION,
          entityId: id,
          actorUserId: actor.principal.userId,
          context: actor.context,
        },
        tx,
      );
      return s;
    });

    this.events.publish(SyndicateEvent.SUBMISSION_RESPONDED, {
      submissionId: id,
      organizationId,
      submittedByUserId: existing.submittedByUserId,
      actorUserId: actor.principal.userId,
    });
    await this.markSeen(actor.principal.userId, id);
    return this.toDTO(updated);
  }

  async close(
    organizationId: string,
    id: string,
    actor: SyndicateActor,
  ): Promise<SyndicateSubmissionDTO> {
    const existing = await this.submissions.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Submission not found');
    }
    SyndicatePolicy.assertNotClosed(existing);

    const updated = await this.db.transaction(async (tx) => {
      const s = await this.submissions.update(id, { status: 'CLOSED' }, tx);
      await this.audit.record(
        {
          action: SyndicateAuditAction.SUBMISSION_CLOSED,
          entityType: SyndicateAuditEntity.SUBMISSION,
          entityId: id,
          actorUserId: actor.principal.userId,
          context: actor.context,
        },
        tx,
      );
      return s;
    });
    await this.markSeen(actor.principal.userId, id);
    return this.toDTO(updated);
  }
}
