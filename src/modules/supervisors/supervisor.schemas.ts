import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { SUPERVISOR_DOMAINS } from '../rbac/rbac.constants.js';
import { SUPERVISOR_ASSIGNMENT_STATUSES } from './supervisor.types.js';

export const listSupervisorsQuerySchema = paginationQuerySchema.extend({
  domain: z.enum(SUPERVISOR_DOMAINS).optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(SUPERVISOR_ASSIGNMENT_STATUSES).optional(),
});
export type ListSupervisorsQuery = z.infer<typeof listSupervisorsQuerySchema>;

export const assignSupervisorBodySchema = z.object({
  userId: z.string().uuid(),
  domain: z.enum(SUPERVISOR_DOMAINS),
});
export type AssignSupervisorBody = z.infer<typeof assignSupervisorBodySchema>;
