import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
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

  async create(
    organizationId: string,
    input: CreateAppointmentInput,
    actor: FarmActor,
  ): Promise<FarmAppointment> {
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
    return this.db.transaction(async (tx) => {
      const updated = await this.appointments.update(appointmentId, patch, tx);
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
      return updated;
    });
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
