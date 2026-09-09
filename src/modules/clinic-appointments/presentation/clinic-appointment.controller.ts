import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { ClinicAppointmentService } from '../application/clinic-appointment.service.js';
import type {
  CreateClinicAppointmentBody,
  DecisionReasonBody,
  ListClinicAppointmentsForClinicQuery,
  ListClinicAppointmentsQuery,
  ProposeRescheduleBody,
  RespondRescheduleBody,
  UpdateStatusBody,
} from './clinic-appointment.schemas.js';

/** Thin HTTP adapter for the clinic-appointment workflow. */
export class ClinicAppointmentController {
  constructor(private readonly service: ClinicAppointmentService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- pet owner -------------------------------------------------

  /** `POST /organizations/:organizationId/clinic-appointments` */
  create = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const body = validatedBody<CreateClinicAppointmentBody>(req);
    const appointment = await this.service.create(organizationId, body, this.actor(req));
    sendSuccess(res, appointment, StatusCodes.CREATED);
  };

  /** `GET /clinic-appointments` — the caller's own appointments. */
  listMine = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const q = validatedQuery<ListClinicAppointmentsQuery>(req);
    const { items, total } = await this.service.listForOwner(auth.userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  /** `GET /clinic-appointments/:appointmentId` — owner or clinic member. */
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    sendSuccess(res, await this.service.getForActor(appointmentId, this.actor(req)));
  };

  /** `GET /clinic-appointments/:appointmentId/history` */
  history = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    sendSuccess(res, await this.service.historyForActor(appointmentId, this.actor(req)));
  };

  /** `POST /clinic-appointments/:appointmentId/cancel` */
  cancel = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    sendSuccess(res, await this.service.cancel(appointmentId, this.actor(req)));
  };

  /** `POST /clinic-appointments/:appointmentId/reschedule-response` */
  respondReschedule = async (req: Request, res: Response): Promise<void> => {
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    const body = validatedBody<RespondRescheduleBody>(req);
    sendSuccess(
      res,
      await this.service.respondToReschedule(appointmentId, body.accept, this.actor(req)),
    );
  };

  // --- clinic side (future Clinic Dashboard) -------------------

  /** `GET /organizations/:organizationId/clinic-appointments` */
  listForClinic = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListClinicAppointmentsForClinicQuery>(req);
    const { items, total } = await this.service.listForClinic(org.id, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  confirm = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    sendSuccess(res, await this.service.confirm(org.id, appointmentId, this.actor(req)));
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    const body = validatedBody<DecisionReasonBody>(req);
    sendSuccess(res, await this.service.reject(org.id, appointmentId, body.reason, this.actor(req)));
  };

  proposeReschedule = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    const body = validatedBody<ProposeRescheduleBody>(req);
    sendSuccess(
      res,
      await this.service.proposeReschedule(org.id, appointmentId, body, this.actor(req)),
    );
  };

  complete = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    sendSuccess(res, await this.service.complete(org.id, appointmentId, this.actor(req)));
  };

  updateStatus = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const { appointmentId } = validatedParams<{ appointmentId: string }>(req);
    const body = validatedBody<UpdateStatusBody>(req);
    sendSuccess(
      res,
      await this.service.updateStatus(org.id, appointmentId, body.status, body.reason, this.actor(req)),
    );
  };
}
