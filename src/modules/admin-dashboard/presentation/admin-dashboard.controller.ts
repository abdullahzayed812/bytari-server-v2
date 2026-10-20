import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AdminDashboardService } from '../application/admin-dashboard.service.js';
import type { AdminDashboardCardId } from '../domain/admin-dashboard.types.js';

export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly authz: AuthorizationService,
  ) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const principal = requireAuth(req);
    const isAdmin = this.authz.isAdmin(principal);
    // Recent activity is Admin-only — never shown to system supervisors.
    // Pending tasks are filtered per task with the permission its target
    // action requires (type-scoped for organization tasks, exactly like the
    // `/admin/organizations` routes and `/admin/veterinarians/:id/approve`).
    const summary = await this.dashboard.getSummary(principal.userId, {
      includeRecentActivity: isAdmin,
      canSeeTask: async (kind, organizationType) => {
        if (isAdmin) return true;
        if (kind === 'VET_APPLICATION') return this.authz.can(principal, 'veterinarian.approve');
        return this.authz.canForOrganizationType(
          principal,
          kind === 'ORGANIZATION_APPROVAL'
            ? 'organization.admin.approve'
            : 'organization.admin.subscription',
          organizationType,
        );
      },
    });
    sendSuccess(res, summary, StatusCodes.OK);
  };

  markCardSeen = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { cardId } = validatedParams<{ cardId: AdminDashboardCardId }>(req);
    await this.dashboard.markCardSeen(userId, cardId);
    sendSuccess(res, { seen: true });
  };
}
