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
import type { OrganizationEngagementService } from '../application/organization-engagement.service.js';
import { requireOrganization } from './organization.middleware.js';
import type {
  AddMemberBody,
  AssignSupervisorBody,
  CreateOrganizationBody,
  DiscoverOrganizationsQuery,
  FinalizeGalleryBody,
  FinalizeLogoBody,
  GalleryUploadUrlBody,
  ListMembersQuery,
  ListMyOrganizationsQuery,
  ListReviewsQuery,
  LogoUploadUrlBody,
  RemoveGalleryImageQuery,
  SubmitReviewBody,
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
    private readonly engagement: OrganizationEngagementService,
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

  /**
   * `GET /organizations/discover/:organizationId` — the Clinic Details screen.
   * Composes three independent reads: the base public profile, the ACTIVE
   * veterinarian roster (from memberships — not a field on the org), and the
   * viewer's engagement summary (follow state, rating). All three 404 the same
   * way when the org doesn't exist / isn't ACTIVE, since `organizations.getPublicById`
   * is the one that actually enforces that and `Promise.all` rejects together.
   */
  getPublicOne = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const { userId } = requireAuth(req);
    const [organization, veterinarians, engagementSummary] = await Promise.all([
      this.organizations.getPublicById(organizationId),
      this.members.listPublicVeterinarians(organizationId),
      this.engagement.getSummary(organizationId, userId),
    ]);
    sendSuccess(res, { ...organization, veterinarians, engagement: engagementSummary });
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

  // --- gallery --------------------------------------------------------

  requestGalleryUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<GalleryUploadUrlBody>(req);
    sendSuccess(
      res,
      await this.organizations.requestGalleryUploadUrl(org.id, body),
      StatusCodes.CREATED,
    );
  };

  addGalleryImage = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<FinalizeGalleryBody>(req);
    sendSuccess(res, await this.organizations.addGalleryImage(org.id, this.actor(req), body));
  };

  removeGalleryImage = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { storageKey } = validatedQuery<RemoveGalleryImageQuery>(req);
    sendSuccess(
      res,
      await this.organizations.removeGalleryImage(org.id, this.actor(req), storageKey),
    );
  };

  // --- engagement: follow + reviews ------------------------------

  follow = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const org = requireOrganization(req);
    await this.engagement.follow(org.id, userId);
    sendSuccess(res, { success: true });
  };

  unfollow = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const org = requireOrganization(req);
    await this.engagement.unfollow(org.id, userId);
    sendSuccess(res, { success: true });
  };

  submitReview = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const org = requireOrganization(req);
    const body = validatedBody<SubmitReviewBody>(req);
    sendSuccess(
      res,
      await this.engagement.submitReview(org.id, userId, {
        rating: body.rating,
        comment: body.comment ?? null,
      }),
    );
  };

  listReviews = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListReviewsQuery>(req);
    const { items, total } = await this.engagement.listReviews(org.id, q.page, q.pageSize);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
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
      { userId: body.userId, email: body.email, roleKey: body.role },
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
