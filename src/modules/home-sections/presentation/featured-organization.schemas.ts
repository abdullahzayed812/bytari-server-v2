import { z } from 'zod';
import { dateOnlySchema } from '../../../shared/validation/date-only.js';
import { FEATURED_PLACEMENTS } from '../domain/featured-organization.types.js';

const placement = z.enum(FEATURED_PLACEMENTS);
const sortOrder = z.number().int().min(0).max(9999);

export const featuredPlacementQuerySchema = z.object({ placement }).strict();
export type FeaturedPlacementQuery = z.infer<typeof featuredPlacementQuerySchema>;

export const adminFeaturedListQuerySchema = z.object({ placement: placement.optional() }).strict();
export type AdminFeaturedListQuery = z.infer<typeof adminFeaturedListQuerySchema>;

export const featuredIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export type FeaturedIdParams = z.infer<typeof featuredIdParamSchema>;

export const createFeaturedBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    placement,
    startsOn: dateOnlySchema(),
    endsOn: dateOnlySchema(),
    isEnabled: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict()
  .refine((b) => b.endsOn >= b.startsOn, {
    message: 'The end date must be on or after the start date',
    path: ['endsOn'],
  });
export type CreateFeaturedBody = z.infer<typeof createFeaturedBodySchema>;

export const updateFeaturedBodySchema = z
  .object({
    startsOn: dateOnlySchema().optional(),
    endsOn: dateOnlySchema().optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: sortOrder.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type UpdateFeaturedBody = z.infer<typeof updateFeaturedBodySchema>;
