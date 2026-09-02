import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AnimalPublicationService } from '../application/animal-publication.service.js';
import type {
  InteractionActor,
  PublicationInteractionService,
} from '../application/publication-interaction.service.js';
import { requireAnimal } from './animal.middleware.js';
import type {
  CreateInteractionBody,
  CreatePublicationBody,
  PublicPublicationsQuery,
} from './publication.schemas.js';

interface PageQuery {
  page: number;
  pageSize: number;
}

/**
 * Owner-facing publication create / read, the authenticated public browse,
 * and the viewer interaction actions ("طلب التبني" / "طلب تزاوج" / "ابلاغ عن
 * مشاهدة"). Moderation lives in {@link AdminPublicationController}.
 */
export class PublicationController {
  constructor(
    private readonly publications: AnimalPublicationService,
    private readonly interactions: PublicationInteractionService,
  ) {}

  private actor(req: Request): InteractionActor {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /** `POST /animals/:animalId/publications` — owner only (enforced by route guard). */
  create = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const body = validatedBody<CreatePublicationBody>(req);
    const dto = await this.publications.create(
      {
        id: animal.id,
        status: animal.status,
        currentOwnerUserId: animal.currentOwnerUserId,
      },
      body,
      this.actor(req),
    );
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  /** `GET /animals/:animalId/publications` — owner / ADMIN / ANIMAL supervisor. */
  listForAnimal = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const q = validatedQuery<PageQuery>(req);
    const { items, total } = await this.publications.listForAnimal(animal.id, {
      page: q.page,
      pageSize: q.pageSize,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getForAnimal = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    sendSuccess(res, await this.publications.getForAnimal(animal.id, publicationId));
  };

  // --- authenticated public browse (APPROVED only, no owner PII) ---

  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<PublicPublicationsQuery>(req);
    const { items, total } = await this.publications.listPublic({
      page: q.page,
      pageSize: q.pageSize,
      kind: q.kind,
      species: q.species,
      search: q.search,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    sendSuccess(res, await this.publications.getPublic(publicationId));
  };

  // --- viewer interactions: "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" ---

  createInteraction = async (req: Request, res: Response): Promise<void> => {
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    const body = validatedBody<CreateInteractionBody>(req);
    sendSuccess(
      res,
      await this.interactions.create(publicationId, body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };
}
