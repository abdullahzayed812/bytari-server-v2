import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { CategoryService } from '../application/category.service.js';
import type { CreateCategoryBody, UpdateCategoryBody } from './content.schemas.js';

export class CategoryController {
  constructor(private readonly categories: CategoryService) {}

  private actor(req: Request): {
    actorUserId: string;
    context: ReturnType<typeof auditContextFromRequest>;
  } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.categories.list());
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCategoryBody>(req);
    sendSuccess(res, await this.categories.create(this.actor(req), body), StatusCodes.CREATED);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { categoryId } = validatedParams<{ categoryId: string }>(req);
    const body = validatedBody<UpdateCategoryBody>(req);
    sendSuccess(res, await this.categories.update(this.actor(req), categoryId, body));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { categoryId } = validatedParams<{ categoryId: string }>(req);
    await this.categories.remove(this.actor(req), categoryId);
    res.status(StatusCodes.NO_CONTENT).send();
  };
}
