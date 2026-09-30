import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { ChatService } from '../../chat/application/chat.service.js';
import type { PublicationKind } from '../domain/publication.constants.js';
import { PublicationPolicy } from '../domain/publication.policy.js';
import type {
  CreateInteractionInput,
  MyInteractionDTO,
  OwnerInteractionDTO,
  PublicationInteraction,
} from '../domain/publication.types.js';
import type { AnimalPublicationService } from './animal-publication.service.js';
import type { PublicationInteractionRepository } from '../infrastructure/publication-interaction.repository.js';

export interface InteractionActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" — a viewer's request / report
 * on an APPROVED, still-available listing. It records the interest (one row
 * per requester + type, re-sending updates it), notifies the owner (domain
 * event → Notifications) and opens the in-app conversation between the two
 * parties (`ANIMAL_PUBLICATION` in the existing chat system), so they talk
 * inside the app. The owner sees every request on their listing; the
 * requester sees their own requests with the listing's current outcome
 * (available / FOUND / ADOPTED / CLOSED).
 */
export class PublicationInteractionService {
  private readonly log: Logger;

  constructor(
    private readonly interactions: PublicationInteractionRepository,
    private readonly publications: AnimalPublicationService,
    private readonly chat: ChatService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'publication-interaction-service' });
  }

  async create(
    publicationId: string,
    input: CreateInteractionInput,
    actor: InteractionActor,
  ): Promise<PublicationInteraction> {
    const publication = await this.publications.loadOwnershipContext(publicationId);
    if (!publication || publication.status !== 'APPROVED') {
      throw new NotFoundError('Publication not found');
    }
    PublicationPolicy.assertNotOwnPublication(publication, actor.actorUserId);
    if (publication.resolution !== null) {
      throw new ConflictError('This listing is no longer available', {
        code: ErrorCode.PUBLICATION_RESOLVED,
      });
    }

    const recorded = await this.interactions.upsert(publicationId, actor.actorUserId, input);

    // The in-app conversation between the requester and the owner (idempotent).
    const { conversation } = await this.chat.getOrCreatePublicationContact(actor, {
      publicationId,
      interestedUserId: actor.actorUserId,
      ownerUserId: publication.createdByUserId,
    });
    const interaction =
      recorded.conversationId === conversation.id
        ? recorded
        : await this.interactions.setConversation(recorded.id, conversation.id);

    this.events.publish('animal.publication.interaction.created', {
      interactionId: interaction.id,
      publicationId,
      type: input.type,
      kind: publication.kind,
      requesterUserId: actor.actorUserId,
      publicationOwnerUserId: publication.createdByUserId,
      conversationId: conversation.id,
    });

    return interaction;
  }

  /** The listing OWNER's view of the requests / reports on one listing. */
  async listForOwner(
    publicationId: string,
    actor: InteractionActor,
  ): Promise<OwnerInteractionDTO[]> {
    const publication = await this.publications.loadOwnershipContext(publicationId);
    if (!publication || publication.createdByUserId !== actor.actorUserId) {
      throw new NotFoundError('Publication not found');
    }
    const rows = await this.interactions.listForPublication(publicationId);
    return Promise.all(
      rows.map(async ({ requester, ...rest }) => ({
        ...rest,
        requester: {
          id: requester.id,
          firstName: requester.firstName,
          lastName: requester.lastName,
          avatarUrl: await this.publications.resolveUserAvatar(requester.avatarKey),
        },
      })),
    );
  }

  /**
   * The owner opens (or reopens) the conversation for one request — e.g. a
   * request recorded before listing conversations existed. Owner only.
   */
  async openConversation(
    publicationId: string,
    interactionId: string,
    actor: InteractionActor,
  ): Promise<{ conversationId: string }> {
    const publication = await this.publications.loadOwnershipContext(publicationId);
    if (!publication || publication.createdByUserId !== actor.actorUserId) {
      throw new NotFoundError('Publication not found');
    }
    const row = (await this.interactions.listForPublication(publicationId)).find(
      (i) => i.id === interactionId,
    );
    if (!row) throw new NotFoundError('Request not found');
    const { conversation } = await this.chat.getOrCreatePublicationContact(actor, {
      publicationId,
      interestedUserId: row.requesterUserId,
      ownerUserId: publication.createdByUserId,
    });
    if (row.conversationId !== conversation.id) {
      await this.interactions.setConversation(row.id, conversation.id);
    }
    return { conversationId: conversation.id };
  }

  /** The requester's own requests / reports, with each listing's current outcome. */
  async listMine(
    actor: InteractionActor,
    filter: { page: number; pageSize: number; kind?: PublicationKind },
  ): Promise<{ items: MyInteractionDTO[]; total: number }> {
    return this.interactions.listMine(actor.actorUserId, filter);
  }
}
