import type { Request, Response } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { OrganizationService } from '../application/organization.service.js';
import type { MembershipService } from '../application/membership.service.js';
import type { OrganizationSupervisorService } from '../application/organization-supervisor.service.js';
import type { OrganizationRepository } from '../infrastructure/organization.repository.js';
import type {
  AdminListOrganizationsQuery,
  RejectOrganizationBody,
  StatusChangeBody,
} from './organization.schemas.js';

/** System-wide organization administration. Every route requires an `organization.admin.*` permission. */
export class AdminOrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly organizationRepo: OrganizationRepository,
    private readonly members: MembershipService,
    private readonly supervisors: OrganizationSupervisorService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<AdminListOrganizationsQuery>(req);
    const { items, total } = await this.organizations.listForAdmin({
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      status: q.status,
      ownerUserId: q.ownerUserId,
      search: q.search,
    });
    sendSuccess(res, items, 200, pageMeta(q.page, q.pageSize, total));
  };

  pending = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<AdminListOrganizationsQuery>(req);
    const { items, total } = await this.organizations.listPendingForAdmin(q.page, q.pageSize);
    sendSuccess(res, items, 200, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const org = await this.organizations.getWithDetails(id);
    if (!org) throw new NotFoundError('Organization not found');
    sendSuccess(res, org);
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.organizations.approve(id, this.actor(req)));
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const { reason } = validatedBody<RejectOrganizationBody>(req);
    sendSuccess(res, await this.organizations.reject(id, reason, this.actor(req)));
  };

  suspend = (req: Request, res: Response): Promise<void> => this.changeStatus(req, res, 'suspend');
  activate = (req: Request, res: Response): Promise<void> =>
    this.changeStatus(req, res, 'activate');
  deactivate = (req: Request, res: Response): Promise<void> =>
    this.changeStatus(req, res, 'deactivate');

  private async changeStatus(
    req: Request,
    res: Response,
    op: 'suspend' | 'activate' | 'deactivate',
  ): Promise<void> {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<StatusChangeBody>(req);
    sendSuccess(res, await this.organizations.changeStatus(id, op, this.actor(req), body.reason));
  }

  listMembers = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    if (!(await this.organizationRepo.findById(id))) {
      throw new NotFoundError('Organization not found');
    }
    const { items, total } = await this.members.list(id, { page: 1, pageSize: 100 });
    sendSuccess(res, items, 200, pageMeta(1, 100, total));
  };

  removeMember = async (req: Request, res: Response): Promise<void> => {
    const { id, memberId } = validatedParams<{ id: string; memberId: string }>(req);
    await this.members.removeMember(id, memberId, this.actor(req));
    sendSuccess(res, { success: true });
  };

  removeSupervisor = async (req: Request, res: Response): Promise<void> => {
    const { id, memberId } = validatedParams<{ id: string; memberId: string }>(req);
    await this.supervisors.remove(id, memberId, this.actor(req));
    sendSuccess(res, { success: true });
  };
}
