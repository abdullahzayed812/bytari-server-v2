import type { Knex } from 'knex';
import type { Logger } from 'pino';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AnimalService } from '../../animals/application/animal.service.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import {
  ClinicAppointmentAuditAction,
  ClinicAppointmentAuditEntity,
  ClinicAppointmentEvent,
  CLINIC_APPOINTMENT_OPEN_STATUSES,
  type ClinicAppointmentActorSide,
} from '../domain/clinic-appointment.constants.js';
import { ClinicAppointmentPolicy } from '../domain/clinic-appointment.policy.js';
import {
  toClinicAppointmentDTO,
  type ClinicAppointment,
  type ClinicAppointmentDTO,
  type ClinicAppointmentHistoryEntry,
  type ClinicAppointmentListFilter,
  type CreateClinicAppointmentInput,
  type ProposeRescheduleInput,
} from '../domain/clinic-appointment.types.js';
import type {
  ClinicAppointmentRepository,
  ClinicAppointmentWithJoins,
} from '../infrastructure/clinic-appointment.repository.js';

export interface ClinicAppointmentActor {
  actorUserId: string;
  context?: AuditContext;
}

/** Status the generic clinic-side `PATCH /status` endpoint accepts. */
export type ClinicStatusUpdate = 'CONFIRMED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';

/**
 * Pet Owner ↔ Clinic appointment workflow.
 *
 * Authorization is RELATIONSHIP-scoped and evaluated against CURRENT state
 * (mirrors {@link ChatService}):
 *  - the PET OWNER side is `clinic_appointments.pet_owner_user_id`;
 *  - the CLINIC side is any ACTIVE member of the appointment's organization.
 *
 * A request that the caller has no relationship to 404s (never 403) so ids do
 * not leak. Ownership of the selected pet, the clinic's existence + ACTIVE
 * status, and every state transition are enforced here — never trusted from the
 * request body.
 */
export class ClinicAppointmentService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly appointments: ClinicAppointmentRepository,
    private readonly animals: AnimalService,
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'clinic-appointment-service' });
  }

  // --- access core --------------------------------------------------

  private async resolveViewerSide(
    userId: string,
    appointment: Pick<ClinicAppointment, 'petOwnerUserId' | 'organizationId'>,
  ): Promise<ClinicAppointmentActorSide | null> {
    if (userId === appointment.petOwnerUserId) return 'PET_OWNER';
    const membership = await this.memberships.findByUserAndOrg(userId, appointment.organizationId);
    return membership?.status === 'ACTIVE' ? 'CLINIC' : null;
  }

  private async loadForActor(
    appointmentId: string,
    userId: string,
  ): Promise<{ data: ClinicAppointmentWithJoins; side: ClinicAppointmentActorSide }> {
    const data = await this.appointments.findWithJoinsById(appointmentId);
    if (!data) throw new NotFoundError('Appointment not found');
    const side = await this.resolveViewerSide(userId, data.appointment);
    if (!side) throw new NotFoundError('Appointment not found');
    return { data, side };
  }

  private dto(
    data: ClinicAppointmentWithJoins,
    side: ClinicAppointmentActorSide,
  ): ClinicAppointmentDTO {
    return toClinicAppointmentDTO(data.appointment, data.joins, side);
  }

  private async mustGetDTO(
    appointmentId: string,
    side: ClinicAppointmentActorSide,
  ): Promise<ClinicAppointmentDTO> {
    const data = await this.appointments.findWithJoinsById(appointmentId);
    if (!data) throw new NotFoundError('Appointment not found');
    return this.dto(data, side);
  }

  // --- create (pet owner) ----------------------------------------

  async create(
    organizationId: string,
    input: CreateClinicAppointmentInput,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    // 1. the selected pet must belong to the caller and be ACTIVE.
    const animalCtx = await this.animals.loadContext(input.animalId);
    if (!animalCtx || animalCtx.currentOwnerUserId !== actor.actorUserId) {
      throw new NotFoundError('Animal not found');
    }
    if (animalCtx.status !== 'ACTIVE') {
      throw new ConflictError('The animal is deactivated and cannot be booked for a visit', {
        code: ErrorCode.ANIMAL_NOT_ACTIVE,
      });
    }

    // 2. the clinic must exist, be a CLINIC, and be ACTIVE.
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'CLINIC') throw new NotFoundError('Clinic not found');
    if (org.status !== 'ACTIVE') {
      throw new ForbiddenError('The clinic is not active — booking is disabled', {
        code: ErrorCode.ORGANIZATION_NOT_ACTIVE,
      });
    }

    // 3. the requested slot must be in the future.
    ClinicAppointmentPolicy.assertSlotInFuture(input.scheduledFor);

    const created = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.create(
        {
          ...input,
          note: input.note?.trim() || null,
          organizationId,
          petOwnerUserId: actor.actorUserId,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId: appointment.id,
          kind: 'REQUESTED',
          actorSide: 'PET_OWNER',
          actorUserId: actor.actorUserId,
          toScheduledFor: appointment.scheduledFor,
        },
        tx,
      );
      await this.audit.record(
        {
          action: ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_REQUESTED,
          entityType: ClinicAppointmentAuditEntity.CLINIC_APPOINTMENT,
          entityId: appointment.id,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            animalId: input.animalId,
            visitType: input.visitType,
          },
          context: actor.context,
        },
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.REQUESTED, created, actor.actorUserId);
    return this.mustGetDTO(created.id, 'PET_OWNER');
  }

  // --- reads -----------------------------------------------------

  async listForOwner(
    userId: string,
    filter: ClinicAppointmentListFilter,
  ): Promise<{ items: ClinicAppointmentDTO[]; total: number }> {
    const { items, total } = await this.appointments.listForOwner(userId, filter);
    return { items: items.map((x) => this.dto(x, 'PET_OWNER')), total };
  }

  /** Clinic Dashboard list — the route middleware has already authorized the caller for `organizationId`. */
  async listForClinic(
    organizationId: string,
    filter: ClinicAppointmentListFilter,
  ): Promise<{ items: ClinicAppointmentDTO[]; total: number }> {
    const { items, total } = await this.appointments.listForOrganization(organizationId, filter);
    return { items: items.map((x) => this.dto(x, 'CLINIC')), total };
  }

  async getForActor(
    appointmentId: string,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const { data, side } = await this.loadForActor(appointmentId, actor.actorUserId);
    return this.dto(data, side);
  }

  async historyForActor(
    appointmentId: string,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentHistoryEntry[]> {
    await this.loadForActor(appointmentId, actor.actorUserId);
    return this.appointments.listEvents(appointmentId);
  }

  // --- pet-owner actions ---------------------------------------

  /** The owner withdraws an open request / booking. */
  async cancel(
    appointmentId: string,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const { data } = await this.loadForActor(appointmentId, actor.actorUserId);
    ClinicAppointmentPolicy.assertPetOwner(data.appointment, actor.actorUserId);
    ClinicAppointmentPolicy.assertStatus(
      data.appointment,
      CLINIC_APPOINTMENT_OPEN_STATUSES,
      'This appointment can no longer be cancelled',
    );

    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        {
          status: 'CANCELLED',
          proposedScheduledFor: null,
          decidedByUserId: actor.actorUserId,
          decidedAt: new Date(),
        },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: 'CANCELLED',
          actorSide: 'PET_OWNER',
          actorUserId: actor.actorUserId,
        },
        tx,
      );
      await this.recordAudit(
        ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_CANCELLED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.CANCELLED, updated, actor.actorUserId);
    return this.mustGetDTO(appointmentId, 'PET_OWNER');
  }

  /** The owner accepts / declines the clinic's proposed alternative slot. */
  async respondToReschedule(
    appointmentId: string,
    accept: boolean,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const { data } = await this.loadForActor(appointmentId, actor.actorUserId);
    ClinicAppointmentPolicy.assertPetOwner(data.appointment, actor.actorUserId);
    ClinicAppointmentPolicy.assertStatus(
      data.appointment,
      ['RESCHEDULE_PROPOSED'],
      'There is no proposed reschedule to respond to',
    );
    const proposed = data.appointment.proposedScheduledFor;
    if (!proposed) throw new ConflictError('There is no proposed reschedule to respond to');

    const previousSlot = data.appointment.scheduledFor;
    const now = new Date();

    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        accept
          ? {
              status: 'CONFIRMED',
              scheduledFor: proposed,
              proposedScheduledFor: null,
              decidedByUserId: actor.actorUserId,
              decidedAt: now,
            }
          : {
              status: 'CANCELLED',
              proposedScheduledFor: null,
              decidedByUserId: actor.actorUserId,
              decidedAt: now,
            },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: accept ? 'RESCHEDULE_ACCEPTED' : 'RESCHEDULE_DECLINED',
          actorSide: 'PET_OWNER',
          actorUserId: actor.actorUserId,
          fromScheduledFor: previousSlot,
          toScheduledFor: accept ? proposed : null,
        },
        tx,
      );
      await this.recordAudit(
        accept
          ? ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_RESCHEDULE_ACCEPTED
          : ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_RESCHEDULE_DECLINED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(
      accept
        ? ClinicAppointmentEvent.RESCHEDULE_ACCEPTED
        : ClinicAppointmentEvent.RESCHEDULE_DECLINED,
      updated,
      actor.actorUserId,
    );
    return this.mustGetDTO(appointmentId, 'PET_OWNER');
  }

  // --- clinic actions (future Clinic Dashboard — no UI yet) ---
  //
  // Every clinic action takes the trusted `:organizationId` from the route
  // (already authorized by `authorizeOrg('clinic_appointment.manage')`) and
  // asserts the appointment belongs to it — an IDOR guard, same idiom as
  // `membership.findByIdInOrg`.

  private assertBelongsToOrg(appointment: ClinicAppointment, organizationId: string): void {
    if (appointment.organizationId !== organizationId) {
      throw new NotFoundError('Appointment not found');
    }
  }

  async confirm(
    organizationId: string,
    appointmentId: string,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) throw new NotFoundError('Appointment not found');
    this.assertBelongsToOrg(existing, organizationId);
    ClinicAppointmentPolicy.assertStatus(
      existing,
      ['PENDING', 'RESCHEDULE_PROPOSED'],
      'This appointment can no longer be confirmed',
    );

    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        {
          status: 'CONFIRMED',
          proposedScheduledFor: null,
          decidedByUserId: actor.actorUserId,
          decidedAt: new Date(),
        },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: 'CONFIRMED',
          actorSide: 'CLINIC',
          actorUserId: actor.actorUserId,
          toScheduledFor: appointment.scheduledFor,
        },
        tx,
      );
      await this.recordAudit(
        ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_CONFIRMED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.CONFIRMED, updated, actor.actorUserId);
    return this.mustGetDTO(appointmentId, 'CLINIC');
  }

  async reject(
    organizationId: string,
    appointmentId: string,
    reason: string | undefined,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) throw new NotFoundError('Appointment not found');
    this.assertBelongsToOrg(existing, organizationId);
    ClinicAppointmentPolicy.assertStatus(
      existing,
      ['PENDING', 'RESCHEDULE_PROPOSED'],
      'This appointment can no longer be rejected',
    );

    const trimmed = reason?.trim() || null;
    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        {
          status: 'REJECTED',
          proposedScheduledFor: null,
          decisionReason: trimmed,
          decidedByUserId: actor.actorUserId,
          decidedAt: new Date(),
        },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: 'REJECTED',
          actorSide: 'CLINIC',
          actorUserId: actor.actorUserId,
          reason: trimmed,
        },
        tx,
      );
      await this.recordAudit(
        ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_REJECTED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.REJECTED, updated, actor.actorUserId);
    return this.mustGetDTO(appointmentId, 'CLINIC');
  }

  async proposeReschedule(
    organizationId: string,
    appointmentId: string,
    input: ProposeRescheduleInput,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) throw new NotFoundError('Appointment not found');
    this.assertBelongsToOrg(existing, organizationId);
    ClinicAppointmentPolicy.assertStatus(
      existing,
      ['PENDING', 'CONFIRMED', 'RESCHEDULE_PROPOSED'],
      'A reschedule cannot be proposed for this appointment',
    );
    ClinicAppointmentPolicy.assertSlotInFuture(input.proposedScheduledFor);

    const trimmed = input.reason?.trim() || null;
    const previousSlot = existing.scheduledFor;
    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        {
          status: 'RESCHEDULE_PROPOSED',
          proposedScheduledFor: input.proposedScheduledFor,
          decisionReason: trimmed,
          decidedByUserId: actor.actorUserId,
          decidedAt: new Date(),
        },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: 'RESCHEDULE_PROPOSED',
          actorSide: 'CLINIC',
          actorUserId: actor.actorUserId,
          fromScheduledFor: previousSlot,
          toScheduledFor: input.proposedScheduledFor,
          reason: trimmed,
        },
        tx,
      );
      await this.recordAudit(
        ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_RESCHEDULE_PROPOSED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.RESCHEDULE_PROPOSED, updated, actor.actorUserId);
    return this.mustGetDTO(appointmentId, 'CLINIC');
  }

  async complete(
    organizationId: string,
    appointmentId: string,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) throw new NotFoundError('Appointment not found');
    this.assertBelongsToOrg(existing, organizationId);
    ClinicAppointmentPolicy.assertStatus(
      existing,
      ['CONFIRMED'],
      'Only a confirmed appointment can be completed',
    );

    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        { status: 'COMPLETED', decidedByUserId: actor.actorUserId, decidedAt: new Date() },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: 'COMPLETED',
          actorSide: 'CLINIC',
          actorUserId: actor.actorUserId,
        },
        tx,
      );
      await this.recordAudit(
        ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_COMPLETED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.COMPLETED, updated, actor.actorUserId);
    return this.mustGetDTO(appointmentId, 'CLINIC');
  }

  /**
   * Generic clinic-side status endpoint (`PATCH .../status`) — a single entry
   * point the future dashboard can drive. Delegates to the dedicated
   * transitions so the guard rails and history events stay identical.
   */
  async updateStatus(
    organizationId: string,
    appointmentId: string,
    status: ClinicStatusUpdate,
    reason: string | undefined,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    switch (status) {
      case 'CONFIRMED':
        return this.confirm(organizationId, appointmentId, actor);
      case 'REJECTED':
        return this.reject(organizationId, appointmentId, reason, actor);
      case 'COMPLETED':
        return this.complete(organizationId, appointmentId, actor);
      case 'CANCELLED':
        return this.clinicCancel(organizationId, appointmentId, reason, actor);
      default:
        throw new ConflictError('Unsupported status transition', {
          code: ErrorCode.CLINIC_APPOINTMENT_INVALID_TRANSITION,
        });
    }
  }

  private async clinicCancel(
    organizationId: string,
    appointmentId: string,
    reason: string | undefined,
    actor: ClinicAppointmentActor,
  ): Promise<ClinicAppointmentDTO> {
    const existing = await this.appointments.findById(appointmentId);
    if (!existing) throw new NotFoundError('Appointment not found');
    this.assertBelongsToOrg(existing, organizationId);
    ClinicAppointmentPolicy.assertStatus(
      existing,
      CLINIC_APPOINTMENT_OPEN_STATUSES,
      'This appointment can no longer be cancelled',
    );

    const trimmed = reason?.trim() || null;
    const updated = await this.db.transaction(async (tx) => {
      const appointment = await this.appointments.update(
        appointmentId,
        {
          status: 'CANCELLED',
          proposedScheduledFor: null,
          decisionReason: trimmed,
          decidedByUserId: actor.actorUserId,
          decidedAt: new Date(),
        },
        tx,
      );
      await this.appointments.insertEvent(
        {
          appointmentId,
          kind: 'CANCELLED',
          actorSide: 'CLINIC',
          actorUserId: actor.actorUserId,
          reason: trimmed,
        },
        tx,
      );
      await this.recordAudit(
        ClinicAppointmentAuditAction.CLINIC_APPOINTMENT_CANCELLED,
        appointment,
        actor,
        tx,
      );
      return appointment;
    });

    this.publish(ClinicAppointmentEvent.CANCELLED, updated, actor.actorUserId);
    return this.mustGetDTO(appointmentId, 'CLINIC');
  }

  // --- helpers -------------------------------------------------

  private recordAudit(
    action: string,
    appointment: ClinicAppointment,
    actor: ClinicAppointmentActor,
    tx: Knex.Transaction,
  ): Promise<unknown> {
    return this.audit.record(
      {
        action,
        entityType: ClinicAppointmentAuditEntity.CLINIC_APPOINTMENT,
        entityId: appointment.id,
        actorUserId: actor.actorUserId,
        metadata: {
          organizationId: appointment.organizationId,
          status: appointment.status,
        },
        context: actor.context,
      },
      tx,
    );
  }

  private publish(name: string, appointment: ClinicAppointment, actorUserId: string): void {
    this.events.publish(name, {
      appointmentId: appointment.id,
      organizationId: appointment.organizationId,
      animalId: appointment.animalId,
      petOwnerUserId: appointment.petOwnerUserId,
      status: appointment.status,
      actorUserId,
    });
  }
}
