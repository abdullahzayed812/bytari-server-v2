import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AnimalRepository } from '../../animals/infrastructure/animal.repository.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { VeterinaryAccessService } from '../application/veterinary-access.service.js';

export const clinicAnimalParamSchema = z.object({
  organizationId: z.string().uuid(),
  animalId: z.string().uuid(),
});

/** Narrow `req.veterinaryAnimal` inside a controller that runs after the guard. */
export function requireVeterinaryAnimal(req: Request): Express.VeterinaryAnimalContext {
  if (!req.veterinaryAnimal) {
    throw new NotFoundError('Animal not found');
  }
  return req.veterinaryAnimal;
}

/**
 * MUST run after `withOrganization` + `authorizeOrg(<perm>)`.
 *
 * Resolves `:animalId`, then enforces the dedicated veterinary-access gate: the
 * URL's clinic must hold an ACTIVE `animal_clinic_access` grant for this animal.
 * A caller without it — even an authorized clinic member — gets a `404`, so the
 * existence of animals a clinic has no relationship with is never revealed
 * (cross-clinic isolation). ADMIN bypasses the grant requirement.
 */
export function createVeterinaryCareMiddleware(deps: {
  animals: AnimalRepository;
  access: VeterinaryAccessService;
  authz: AuthorizationService;
}): { withVeterinaryAnimalAccess: RequestHandler } {
  const withVeterinaryAnimalAccess: RequestHandler = asyncHandler(async (req, _res, next) => {
    const principal = requireAuth(req);
    const org = requireOrganization(req);
    const { animalId } = validatedParams<{ animalId: string }>(req);

    const animal = await deps.animals.findById(animalId);
    if (!animal) throw new NotFoundError('Animal not found');

    if (!deps.authz.isAdmin(principal)) {
      const allowed = await deps.access.hasActiveAccess(animal.id, org.id);
      if (!allowed) throw new NotFoundError('Animal not found');
    }

    req.veterinaryAnimal = { id: animal.id, status: animal.status };
    next();
  });

  return { withVeterinaryAnimalAccess };
}
