import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { MembershipRepository } from '../../organizations/infrastructure/membership.repository.js';
import { PoultryOpsAuditAction, PoultryOpsAuditEntity } from '../domain/poultry-ops.constants.js';
import type {
  CreateAppointmentInput,
  FarmAppointment,
  ListAppointmentsFilter,
  UpdateAppointmentInput,
} from '../domain/poultry-ops.types.js';
import type { FarmAppointmentRepository } from '../infrastructure/farm-appointment.repository.js';

export interface FarmActor {
  actorUserId: string;
  context?: AuditContext;
}

/** "المواعيد" — farm-scoped appointments (vaccination / treatment / vet visit / …). */
export class FarmAppointmentService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly appointments: FarmAppointmentRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly memberships: MembershipRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'farm-appointment-service' });
  }

  list(
    organizationId: string,
    filter: ListAppointmentsFilter,
  ): Promise<{ items: FarmAppointment[]; total: number }> {
    return this.appointments.listForOrganization(organizationId, filter);
  }

  async get(organizationId: string, appointmentId: string): Promise<FarmAppointment> {
    const appointment = await this.appointments.findByIdForOrganization(
      appointmentId,
      organizationId,
    );
    if (!appointment) throw new NotFoundError('Appointment not found');
    return appointment;
  }

  /**
   * The farm's ACTIVE veterinarians an appointment can be assigned to (names
   * only, no email) — readable by whoever can read appointments, so the form
   * does not need `member.read`.
   */
  async listAssignableVeterinarians(
    organizationId: string,
  ): Promise<Array<{ id: string; firstName: string; lastName: string }>> {
    const { items } = await this.memberships.listForOrg(organizationId, {
      page: 1,
      pageSize: 200,
      status: 'ACTIVE',
      roleKey: 'VETERINARIAN',
    });
    return items.map((m) => ({
      id: m.userId,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
    }));
  }

  /** The assignee must be an ACTIVE VETERINARIAN member of THIS farm. */
  private async assertAssignableVeterinarian(
    organizationId: string,
    userId: string | null | undefined,
  ): Promise<void> {
    if (!userId) return;
    const m = await this.memberships.findByUserAndOrg(userId, organizationId);
    if (!m || m.status !== 'ACTIVE' || m.roleKey !== 'VETERINARIAN') {
      throw new ValidationError(
        'The assigned veterinarian must be an active veterinarian of this farm',
        [
          {
            path: 'assignedVeterinarianUserId',
            message: 'Not an active veterinarian of this farm',
          },
        ],
      );
    }
  }

  async create(
    organizationId: string,
    input: CreateAppointmentInput,
    actor: FarmActor,
  ): Promise<FarmAppointment> {
    await this.assertAssignableVeterinarian(organizationId, input.assignedVeterinarianUserId);
    const appointment = await this.db.transaction(async (tx) => {
      const created = await this.appointments.create(
        { ...input, organizationId, createdByUserId: actor.actorUserId },
        tx,
      );
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_APPOINTMENT_CREATED,
          entityType: PoultryOpsAuditEntity.FARM_APPOINTMENT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, category: created.category },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.events.publish('farm.appointment.created', {
      organizationId,
      appointmentId: appointment.id,
      createdByUserId: actor.actorUserId,
      assignedVeterinarianUserId: appointment.assignedVeterinarianUserId,
    });
    return appointment;
  }

  async update(
    organizationId: string,
    appointmentId: string,
    patch: UpdateAppointmentInput,
    actor: FarmActor,
  ): Promise<FarmAppointment> {
    const existing = await this.appointments.findByIdForOrganization(appointmentId, organizationId);
    if (!existing) throw new NotFoundError('Appointment not found');
    await this.assertAssignableVeterinarian(organizationId, patch.assignedVeterinarianUserId);
    const updated = await this.db.transaction(async (tx) => {
      const row = await this.appointments.update(appointmentId, patch, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_APPOINTMENT_UPDATED,
          entityType: PoultryOpsAuditEntity.FARM_APPOINTMENT,
          entityId: appointmentId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return row;
    });
    // A (re)assignment tells the new veterinarian, after commit.
    if (
      updated.assignedVeterinarianUserId &&
      updated.assignedVeterinarianUserId !== existing.assignedVeterinarianUserId
    ) {
      this.events.publish('farm.appointment.assigned', {
        organizationId,
        appointmentId,
        assignedVeterinarianUserId: updated.assignedVeterinarianUserId,
        actorUserId: actor.actorUserId,
      });
    }
    return updated;
  }

  async delete(organizationId: string, appointmentId: string, actor: FarmActor): Promise<void> {
    const existing = await this.appointments.findByIdForOrganization(appointmentId, organizationId);
    if (!existing) throw new NotFoundError('Appointment not found');
    await this.db.transaction(async (tx) => {
      await this.appointments.deleteById(appointmentId, tx);
      await this.audit.record(
        {
          action: PoultryOpsAuditAction.FARM_APPOINTMENT_DELETED,
          entityType: PoultryOpsAuditEntity.FARM_APPOINTMENT,
          entityId: appointmentId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
