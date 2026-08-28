import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AnimalService } from '../application/animal.service.js';

export const animalIdParamSchema = z.object({ animalId: z.string().uuid() });

export interface AnimalMiddleware {
  /**
   * Resolve `:animalId` (trusted route param) → `req.animal`. 404 if it does
   * not exist. Does NOT authorize.
   */
  withAnimal: RequestHandler;
  /**
   * Read access: ADMIN override, current owner, or a holder of `permission`
   * (reserved for future delegation — granted to nobody by default).
   * Otherwise 404 (private resource — existence is not revealed).
   */
  authorizeAnimalRead: (permission: string) => RequestHandler;
  /**
   * Mutations & ownership transfer: ADMIN override or current owner only
   * (spec §4). Otherwise 404.
   */
  authorizeAnimalWrite: () => RequestHandler;
}

/** Narrow `req.animal` inside a controller that runs after `withAnimal`. */
export function requireAnimal(req: Request): Express.AnimalContext {
  if (!req.animal) throw new NotFoundError('Animal not found');
  return req.animal;
}

export function createAnimalMiddleware(deps: {
  animals: AnimalService;
  authz: AuthorizationService;
}): AnimalMiddleware {
  const withAnimal: RequestHandler = asyncHandler(async (req, _res, next) => {
    const { animalId } = validatedParams<{ animalId: string }>(req);
    const ctx = await deps.animals.loadContext(animalId);
    if (!ctx) throw new NotFoundError('Animal not found');
    req.animal = {
      id: ctx.id,
      status: ctx.status,
      currentOwnerUserId: ctx.currentOwnerUserId,
    };
    next();
  });

  const authorizeAnimalRead = (permission: string): RequestHandler =>
    asyncHandler(async (req, _res, next) => {
      const principal = requireAuth(req);
      const animal = requireAnimal(req);
      if (
        deps.authz.isAdmin(principal) ||
        animal.currentOwnerUserId === principal.userId ||
        (await deps.authz.can(principal, permission))
      ) {
        next();
        return;
      }
      throw new NotFoundError('Animal not found');
    });

  const authorizeAnimalWrite = (): RequestHandler =>
    asyncHandler((req, _res, next) => {
      const principal = requireAuth(req);
      const animal = requireAnimal(req);
      if (deps.authz.isAdmin(principal) || animal.currentOwnerUserId === principal.userId) {
        next();
        return;
      }
      throw new NotFoundError('Animal not found');
    });

  return { withAnimal, authorizeAnimalRead, authorizeAnimalWrite };
}
