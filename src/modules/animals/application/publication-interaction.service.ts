import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import { PublicationPolicy } from '../domain/publication.policy.js';
import type { CreateInteractionInput, PublicationInteraction } from '../domain/publication.types.js';
import type { AnimalPublicationService } from './animal-publication.service.js';
import type { PublicationInteractionRepository } from '../infrastructure/publication-interaction.repository.js';

export interface InteractionActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" — a viewer's fire-and-forget
 * interaction with an APPROVED listing. Deliberately not a request/response
 * workflow: it records the interest/report and emits a domain event so the
 * existing Notifications module (Phase 15) tells the listing owner — no
 * accept/reject state, no "manage my requests" screen (not in the reference
 * designs). The owner follows up directly using the listing's own contact info.
 */
export class PublicationInteractionService {
  private readonly log: Logger;

  constructor(
    private readonly interactions: PublicationInteractionRepository,
    private readonly publications: AnimalPublicationService,
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

    const interaction = await this.interactions.upsert(publicationId, actor.actorUserId, input);

    this.events.publish('animal.publication.interaction.created', {
      interactionId: interaction.id,
      publicationId,
      type: input.type,
      kind: publication.kind,
      requesterUserId: actor.actorUserId,
      publicationOwnerUserId: publication.createdByUserId,
    });

    return interaction;
  }
}
