import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { OrganizationService } from '../application/organization.service.js';
import type { MembershipService } from '../application/membership.service.js';
import type { OrganizationSupervisorService } from '../application/organization-supervisor.service.js';
import { requireOrganization } from './organization.middleware.js';
import type {
  AddMemberBody,
  AssignSupervisorBody,
  CreateOrganizationBody,
  DiscoverOrganizationsQuery,
  FinalizeLogoBody,
  ListMembersQuery,
  ListMyOrganizationsQuery,
  LogoUploadUrlBody,
  UpdateMemberBody,
  UpdateOrganizationBody,
  UpdateSupervisorBody,
} from './organization.schemas.js';

/** Member-facing organization endpoints. All organization ids come from the route. */
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly members: MembershipService,
    private readonly supervisors: OrganizationSupervisorService,
    private readonly authz: AuthorizationService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateOrganizationBody>(req);
    const org = await this.organizations.create(
      { type: body.type, name: body.name, description: body.description },
      this.actor(req),
    );
    sendSuccess(res, org, StatusCodes.CREATED);
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const q = validatedQuery<ListMyOrganizationsQuery>(req);
    const all = await this.organizations.listMine(userId);
    const start = (q.page - 1) * q.pageSize;
    sendSuccess(
      res,
      all.slice(start, start + q.pageSize),
      StatusCodes.OK,
      pageMeta(q.page, q.pageSize, all.length),
    );
  };

  discover = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<DiscoverOrganizationsQuery>(req);
    const { items, total } = await this.organizations.discoverPublic({
      page: q.page,
      pageSize: q.pageSize,
      type: q.type,
      search: q.search,
      near: q.sort === 'nearest' ? { lat: q.lat as number, lng: q.lng as number } : undefined,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getPublicOne = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    sendSuccess(res, await this.organizations.getPublicById(organizationId));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const org = requireOrganization(req);
    const [details, ctx] = await Promise.all([
      this.organizations.getWithDetails(org.id),
      this.authz.getOrganizationMembershipContext(auth.userId, org.id),
    ]);
    sendSuccess(res, { ...details, myRole: ctx?.roleKey ?? null });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<UpdateOrganizationBody>(req);
    const updated = await this.organizations.updateProfile(org.id, body, this.actor(req));
    sendSuccess(res, updated);
  };

  requestLogoUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<LogoUploadUrlBody>(req);
    sendSuccess(
      res,
      await this.organizations.requestLogoUploadUrl(org.id, body),
      StatusCodes.CREATED,
    );
  };

  finalizeLogo = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<FinalizeLogoBody>(req);
    sendSuccess(res, await this.organizations.finalizeLogo(org.id, this.actor(req), body));
  };

  leave = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const org = requireOrganization(req);
    await this.members.leave(org.id, auth.userId, auditContextFromRequest(req));
    sendSuccess(res, { success: true });
  };

  // --- members ------------------------------------------------------

  listMembers = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListMembersQuery>(req);
    const { items, total } = await this.members.list(org.id, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      roleKey: q.roleKey,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getMember = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { memberId } = validatedParams<{ memberId: string }>(req);
    sendSuccess(res, await this.members.getMember(org.id, memberId));
  };

  addMember = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<AddMemberBody>(req);
    const member = await this.members.addMember(
      org.id,
      { userId: body.userId, roleKey: body.role },
      this.actor(req),
    );
    sendSuccess(res, member, StatusCodes.CREATED);
  };

  updateMember = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { memberId } = validatedParams<{ memberId: string }>(req);
    const body = validatedBody<UpdateMemberBody>(req);
    const member = await this.members.updateMember(
      org.id,
      memberId,
      { roleKey: body.role, status: body.status },
      this.actor(req),
    );
    sendSuccess(res, member);
  };

  removeMember = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { memberId } = validatedParams<{ memberId: string }>(req);
    await this.members.removeMember(org.id, memberId, this.actor(req));
    sendSuccess(res, { success: true });
  };

  // --- supervisors ---------------------------------------------

  listSupervisors = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    sendSuccess(res, await this.supervisors.list(org.id));
  };

  assignSupervisor = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<AssignSupervisorBody>(req);
    const supervisor = await this.supervisors.assign(
      org.id,
      { userId: body.userId, permissions: body.permissions },
      this.actor(req),
    );
    sendSuccess(res, supervisor, StatusCodes.CREATED);
  };

  updateSupervisor = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { membershipId } = validatedParams<{ membershipId: string }>(req);
    const body = validatedBody<UpdateSupervisorBody>(req);
    const supervisor = await this.supervisors.updatePermissions(
      org.id,
      membershipId,
      body.permissions,
      this.actor(req),
    );
    sendSuccess(res, supervisor);
  };

  removeSupervisor = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { membershipId } = validatedParams<{ membershipId: string }>(req);
    await this.supervisors.remove(org.id, membershipId, this.actor(req));
    sendSuccess(res, { success: true });
  };
}
