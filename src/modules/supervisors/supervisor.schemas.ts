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

/**
 * The UI assigns by EMAIL (the admin types the person's email — no manual
 * UUID entry); `userId` stays accepted for internal / scripted callers.
 * Exactly one of the two.
 */
export const assignSupervisorBodySchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    domain: z.enum(SUPERVISOR_DOMAINS),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: 'Provide exactly one of userId or email',
    path: ['email'],
  });
export type AssignSupervisorBody = z.infer<typeof assignSupervisorBodySchema>;

/**
 * "المشرف" with SEVERAL management sections: the exact set of domains a user
 * supervises. Sections not listed are revoked; listed ones are (re)activated.
 */
export const setSupervisorDomainsBodySchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    domains: z.array(z.enum(SUPERVISOR_DOMAINS)).max(SUPERVISOR_DOMAINS.length),
  })
  .strict()
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: 'Provide exactly one of userId or email',
    path: ['email'],
  })
  .refine((v) => new Set(v.domains).size === v.domains.length, {
    message: 'Duplicate domains',
    path: ['domains'],
  });
export type SetSupervisorDomainsBody = z.infer<typeof setSupervisorDomainsBodySchema>;
