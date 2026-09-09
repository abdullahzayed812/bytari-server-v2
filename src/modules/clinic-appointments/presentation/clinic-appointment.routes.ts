import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { ClinicAppointmentController } from './clinic-appointment.controller.js';
import {
  appointmentIdParamSchema,
  createClinicAppointmentBodySchema,
  decisionReasonBodySchema,
  listClinicAppointmentsForClinicQuerySchema,
  listClinicAppointmentsQuerySchema,
  organizationIdParamSchema,
  proposeRescheduleBodySchema,
  respondRescheduleBodySchema,
  updateStatusBodySchema,
} from './clinic-appointment.schemas.js';

/**
 * `/clinic-appointments*` — the Pet Owner's own appointments. Every action is
 * scoped to the caller's relationship (pet-owner side, or ACTIVE clinic member
 * for reads) INSIDE the service — an appointment the caller has no relationship
 * to 404s, never 403, so its existence is not revealed.
 */
export function createClinicAppointmentRouter(c: Container): Router {
  const ctrl = new ClinicAppointmentController(c.clinicAppointmentService);
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/',
    validate({ query: listClinicAppointmentsQuerySchema }),
    asyncHandler(ctrl.listMine),
  );
  r.get(
    '/:appointmentId',
    validate({ params: appointmentIdParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  r.get(
    '/:appointmentId/history',
    validate({ params: appointmentIdParamSchema }),
    asyncHandler(ctrl.history),
  );
  r.post(
    '/:appointmentId/cancel',
    validate({ params: appointmentIdParamSchema }),
    asyncHandler(ctrl.cancel),
  );
  r.post(
    '/:appointmentId/reschedule-response',
    validate({ params: appointmentIdParamSchema, body: respondRescheduleBodySchema }),
    asyncHandler(ctrl.respondReschedule),
  );

  return r;
}

/**
 * Extends `/organizations/:organizationId/...`:
 *
 *  - `POST /:organizationId/clinic-appointments` — a Pet Owner books a visit.
 *    Authentication + `withOrganization` only (like chat's createConversation):
 *    the pet owner is NOT a clinic member, so there is no org permission to
 *    check. The service enforces CLINIC type + ACTIVE status + pet ownership.
 *
 *  - `GET /:organizationId/clinic-appointments` and the accept / reject /
 *    reschedule / complete / status routes — the future CLINIC DASHBOARD.
 *    Guarded by `authorizeOrg('clinic.appointment.read' | '.manage')`, which
 *    also requires the org to be ACTIVE and the caller an ACTIVE member.
 */
export function createOrgClinicAppointmentRouter(c: Container): Router {
  const ctrl = new ClinicAppointmentController(c.clinicAppointmentService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  // --- Pet Owner: book a visit ------------------------------------
  r.post(
    '/:organizationId/clinic-appointments',
    validate({
      params: organizationIdParamSchema,
      body: createClinicAppointmentBodySchema,
    }),
    withOrganization,
    asyncHandler(ctrl.create),
  );

  // --- Clinic Dashboard (no UI yet) -----------------------------
  r.get(
    '/:organizationId/clinic-appointments',
    validate({
      params: organizationIdParamSchema,
      query: listClinicAppointmentsForClinicQuerySchema,
    }),
    withOrganization,
    authorizeOrg('clinic.appointment.read'),
    asyncHandler(ctrl.listForClinic),
  );
  r.post(
    '/:organizationId/clinic-appointments/:appointmentId/confirm',
    validate({ params: organizationIdParamSchema.merge(appointmentIdParamSchema) }),
    withOrganization,
    authorizeOrg('clinic.appointment.manage'),
    asyncHandler(ctrl.confirm),
  );
  r.post(
    '/:organizationId/clinic-appointments/:appointmentId/reject',
    validate({
      params: organizationIdParamSchema.merge(appointmentIdParamSchema),
      body: decisionReasonBodySchema,
    }),
    withOrganization,
    authorizeOrg('clinic.appointment.manage'),
    asyncHandler(ctrl.reject),
  );
  r.post(
    '/:organizationId/clinic-appointments/:appointmentId/reschedule',
    validate({
      params: organizationIdParamSchema.merge(appointmentIdParamSchema),
      body: proposeRescheduleBodySchema,
    }),
    withOrganization,
    authorizeOrg('clinic.appointment.manage'),
    asyncHandler(ctrl.proposeReschedule),
  );
  r.post(
    '/:organizationId/clinic-appointments/:appointmentId/complete',
    validate({ params: organizationIdParamSchema.merge(appointmentIdParamSchema) }),
    withOrganization,
    authorizeOrg('clinic.appointment.manage'),
    asyncHandler(ctrl.complete),
  );
  r.patch(
    '/:organizationId/clinic-appointments/:appointmentId/status',
    validate({
      params: organizationIdParamSchema.merge(appointmentIdParamSchema),
      body: updateStatusBodySchema,
    }),
    withOrganization,
    authorizeOrg('clinic.appointment.manage'),
    asyncHandler(ctrl.updateStatus),
  );

  return r;
}
