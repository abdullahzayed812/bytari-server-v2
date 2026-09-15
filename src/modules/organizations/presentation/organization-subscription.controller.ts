import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { FarmSubscriptionService } from '../../farms/application/farm-subscription.service.js';
import type {
  ApproveRenewalBody,
  CreateRenewalRequestBody,
  ListRenewalRequestsQuery,
  RejectRenewalBody,
  SetSubscriptionBody,
} from '../../farms/presentation/farm-subscription.schemas.js';
import { requireOrganization } from './organization.middleware.js';

/**
 * HTTP adapter for VETERINARY_OFFICE / CLINIC subscriptions — reuses
 * `FarmSubscriptionService` unchanged (see `FarmSubscriptionRenewalRepository`, which is now
 * organization-type-aware about which `*_details` table to read/write). Mirrors
 * `PoultryOpsController`'s subscription methods exactly; no business logic here.
 */
export class OrganizationSubscriptionController {
  constructor(private readonly subscription: FarmSubscriptionService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  private orgId(req: Request): string {
    return requireOrganization(req).id;
  }

  listRenewals = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListRenewalRequestsQuery>(req);
    const { items, total } = await this.subscription.listRenewalRequests(this.orgId(req), {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, 200, pageMeta(q.page, q.pageSize, total));
  };

  createRenewal = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateRenewalRequestBody>(req);
    sendSuccess(
      res,
      await this.subscription.requestRenewal(requireOrganization(req), body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };

  setSubscription = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<SetSubscriptionBody>(req);
    await this.subscription.setSubscription(this.orgId(req), body, this.actor(req));
    sendSuccess(res, { updated: true });
  };

  approveRenewal = async (req: Request, res: Response): Promise<void> => {
    const { requestId } = validatedParams<{ requestId: string }>(req);
    const body = validatedBody<ApproveRenewalBody>(req);
    sendSuccess(
      res,
      await this.subscription.approveRenewal(this.orgId(req), requestId, body, this.actor(req)),
    );
  };

  rejectRenewal = async (req: Request, res: Response): Promise<void> => {
    const { requestId } = validatedParams<{ requestId: string }>(req);
    const body = validatedBody<RejectRenewalBody>(req);
    sendSuccess(
      res,
      await this.subscription.rejectRenewal(this.orgId(req), requestId, body.reason, this.actor(req)),
    );
  };
}
