import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AnimalRepository } from '../../animals/infrastructure/animal.repository.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';

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
 * MUST run after `withOrganization` + `authorizeOrg(<perm>)` (+ the
 * operability guard).
 *
 * Resolves `:animalId` to a registered pet. There is no clinic ↔ pet link:
 * any operational clinic may open a pet (it reaches the id through the
 * owner's short ID / QR, its own lists, or an appointment) and add its own
 * records. What the clinic may then READ or CHANGE is enforced per row by
 * the services — only rows whose `organization_id` is this clinic — so
 * opening a pet never exposes another clinic's work. Listing-only subjects
 * (adoption / mating / lost) are never patients: `404`, like an unknown id.
 */
export function createVeterinaryCareMiddleware(deps: { animals: AnimalRepository }): {
  withClinicAnimal: RequestHandler;
} {
  const withClinicAnimal: RequestHandler = asyncHandler(async (req, _res, next) => {
    requireAuth(req);
    requireOrganization(req);
    const { animalId } = validatedParams<{ animalId: string }>(req);

    const animal = await deps.animals.findById(animalId);
    if (!animal || animal.listingOnly) throw new NotFoundError('Animal not found');

    req.veterinaryAnimal = { id: animal.id, status: animal.status };
    next();
  });

  return { withClinicAnimal };
}
