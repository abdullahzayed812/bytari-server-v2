import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AnimalService } from '../application/animal.service.js';
import type { ListAdminAnimalsQuery, UpdateAnimalBody } from './animal.schemas.js';

/**
 * Admin / ANIMAL-supervisor oversight of user animals: list every owner's
 * animals (`animal.read`), and soft-delete one (`animal.delete`, ADMIN
 * override). Deletion is `status = DEACTIVATED` — ownership + medical history
 * are preserved.
 */
export class AdminAnimalController {
  constructor(private readonly animals: AnimalService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminAnimalsQuery>(req);
    const { items, total } = await this.animals.listForAdmin({
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      species: q.species,
      search: q.search,
      ownerUserId: q.ownerUserId,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  /**
   * Admin / ANIMAL-supervisor edit of a pet PROFILE (`animal.update`). Same
   * field allow-list as the owner's own edit; it never touches the animal's
   * Adoption / Mating / Lost listings (a separate domain / table).
   */
  update = async (req: Request, res: Response): Promise<void> => {
    const { animalId } = validatedParams<{ animalId: string }>(req);
    const body = validatedBody<UpdateAnimalBody>(req);
    sendSuccess(res, await this.animals.update(animalId, body, this.actor(req)));
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const { animalId } = validatedParams<{ animalId: string }>(req);
    sendSuccess(res, await this.animals.deactivate(animalId, this.actor(req)));
  };
}
