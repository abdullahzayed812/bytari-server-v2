import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AnimalService } from '../application/animal.service.js';
import type { AnimalOwnershipService } from '../application/animal-ownership.service.js';
import { requireAnimal } from './animal.middleware.js';
import type {
  AnimalGalleryUploadUrlBody,
  CreateAnimalBody,
  FinalizeAnimalGalleryBody,
  ListAnimalsQuery,
  RemoveAnimalGalleryImageQuery,
  UpdateAnimalBody,
} from './animal.schemas.js';

/** Thin HTTP adapter for the Animal Core + ownership use-cases. No business logic. */
export class AnimalController {
  constructor(
    private readonly animals: AnimalService,
    private readonly ownership: AnimalOwnershipService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateAnimalBody>(req);
    const animal = await this.animals.create(
      {
        name: body.name,
        species: body.species,
        breed: body.breed,
        sex: body.sex,
        dateOfBirth: body.dateOfBirth,
        notes: body.notes,
      },
      this.actor(req),
    );
    sendSuccess(res, animal, StatusCodes.CREATED);
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const q = validatedQuery<ListAnimalsQuery>(req);
    const { items, total } = await this.animals.list(auth.userId, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      species: q.species,
      search: q.search,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    sendSuccess(res, await this.animals.getDTOById(animal.id));
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const body = validatedBody<UpdateAnimalBody>(req);
    sendSuccess(res, await this.animals.update(animal.id, body, this.actor(req)));
  };

  deactivate = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    sendSuccess(res, await this.animals.deactivate(animal.id, this.actor(req)));
  };

  history = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    sendSuccess(res, await this.ownership.history(animal.id));
  };

  // --- gallery --------------------------------------------------------

  requestGalleryUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const body = validatedBody<AnimalGalleryUploadUrlBody>(req);
    sendSuccess(
      res,
      await this.animals.requestGalleryUploadUrl(animal.id, this.actor(req), body),
      StatusCodes.CREATED,
    );
  };

  addGalleryImage = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const body = validatedBody<FinalizeAnimalGalleryBody>(req);
    sendSuccess(res, await this.animals.addGalleryImage(animal.id, this.actor(req), body));
  };

  removeGalleryImage = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const { storageKey } = validatedQuery<RemoveAnimalGalleryImageQuery>(req);
    sendSuccess(res, await this.animals.removeGalleryImage(animal.id, this.actor(req), storageKey));
  };
}
