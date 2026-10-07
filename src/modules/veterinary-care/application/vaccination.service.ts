import { businessToday } from '../../../shared/time/business-date.js';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AnimalOwnershipRepository } from '../../animals/infrastructure/animal-ownership.repository.js';
import type { AnimalRepository } from '../../animals/infrastructure/animal.repository.js';
import type { VaccinationStatus } from '../domain/veterinary-care.constants.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import {
  toOwnerVaccinationDTO,
  toVaccinationDTO,
  type ClinicListAnimalSummary,
  type ClinicListOwnerSummary,
  type ClinicVaccinationListStatus,
  type CreateVaccinationInput,
  type ListVaccinationsFilter,
  type UpdateVaccinationInput,
  type VaccinationDTO,
} from '../domain/veterinary-care.types.js';
import type { VaccinationRepository } from '../infrastructure/vaccination.repository.js';

export interface VetCareActor {
  actorUserId: string;
  context?: AuditContext;
}

/** One row of the clinic-wide list ("التطعيمات" screen). */
export interface ClinicVaccinationDTO {
  vaccination: VaccinationDTO;
  animal: ClinicListAnimalSummary;
  owner: ClinicListOwnerSummary | null;
  /** SCHEDULED with a next dose before today (legacy derived `overdue`). */
  isOverdue: boolean;
}

/** No explicit status → SCHEDULED when a next dose is due, else COMPLETED (matches the backfill). */
function defaultStatus(nextDueOn: string | null | undefined): VaccinationStatus {
  return nextDueOn ? 'SCHEDULED' : 'COMPLETED';
}

/** Vaccination history — same authorization model as {@link MedicalRecordService}. */
export class VaccinationService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly vaccinations: VaccinationRepository,
    private readonly animals: AnimalRepository,
    private readonly ownerships: AnimalOwnershipRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'vaccination-service' });
  }

  async createForClinic(
    organizationId: string,
    animal: { id: string; status: string },
    input: CreateVaccinationInput,
    actor: VetCareActor,
  ): Promise<VaccinationDTO> {
    VeterinaryCarePolicy.assertAnimalActive(animal);
    VeterinaryCarePolicy.assertVaccinationDates(input.administeredOn, input.nextDueOn);

    const vaccination = await this.db.transaction(async (tx) => {
      const created = await this.vaccinations.create(
        {
          animalId: animal.id,
          organizationId,
          recordedByUserId: actor.actorUserId,
          vaccineName: input.vaccineName,
          administeredOn: input.administeredOn,
          nextDueOn: input.nextDueOn ?? null,
          status: input.status ?? defaultStatus(input.nextDueOn),
          notes: input.notes ?? null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.VACCINATION_CREATED,
          entityType: AuditEntityType.VACCINATION,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId: animal.id, vaccinationId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    // The owner is told a vaccination was added (legacy behaviour).
    this.events.publish('vaccination.created', {
      vaccinationId: vaccination.id,
      animalId: animal.id,
      organizationId,
      petOwnerUserId: await this.ownerships.currentOwnerUserId(animal.id),
      actorUserId: actor.actorUserId,
    });
    return toVaccinationDTO(vaccination);
  }

  async getForClinic(animalId: string, vaccinationId: string): Promise<VaccinationDTO> {
    const v = await this.vaccinations.findByIdForAnimal(vaccinationId, animalId);
    if (!v) throw new NotFoundError('Vaccination not found');
    return toVaccinationDTO(v);
  }

  async listForClinic(
    animalId: string,
    filter: ListVaccinationsFilter,
  ): Promise<{ items: VaccinationDTO[]; total: number }> {
    const { items, total } = await this.vaccinations.listForAnimal(animalId, filter);
    return { items: items.map(toVaccinationDTO), total };
  }

  async updateForClinic(
    organizationId: string,
    animalId: string,
    vaccinationId: string,
    patch: UpdateVaccinationInput,
    actor: VetCareActor,
  ): Promise<VaccinationDTO> {
    const existing = await this.vaccinations.findByIdForAnimal(vaccinationId, animalId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Vaccination not found');
    }
    const animal = await this.animals.findById(animalId);
    if (!animal) throw new InternalError('animal missing for an existing vaccination');
    VeterinaryCarePolicy.assertAnimalActive(animal);
    VeterinaryCarePolicy.assertVaccinationDates(
      patch.administeredOn ?? existing.administeredOn,
      patch.nextDueOn === undefined ? existing.nextDueOn : patch.nextDueOn,
    );

    const updated = await this.db.transaction(async (tx) => {
      const v = await this.vaccinations.update(
        vaccinationId,
        {
          vaccineName: patch.vaccineName,
          administeredOn: patch.administeredOn,
          nextDueOn: patch.nextDueOn,
          status: patch.status,
          notes: patch.notes,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.VACCINATION_UPDATED,
          entityType: AuditEntityType.VACCINATION,
          entityId: vaccinationId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            animalId,
            vaccinationId,
            fields: Object.keys(patch),
          },
          context: actor.context,
        },
        tx,
      );
      return v;
    });

    this.events.publish('vaccination.updated', {
      vaccinationId,
      animalId,
      organizationId,
    });
    return toVaccinationDTO(updated);
  }

  async deleteForClinic(
    organizationId: string,
    animalId: string,
    vaccinationId: string,
    actor: VetCareActor,
  ): Promise<void> {
    const existing = await this.vaccinations.findByIdForAnimal(vaccinationId, animalId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Vaccination not found');
    }

    await this.db.transaction(async (tx) => {
      const deleted = await this.vaccinations.deleteById(vaccinationId, tx);
      if (deleted !== 1) throw new NotFoundError('Vaccination not found');
      await this.audit.record(
        {
          action: AuditAction.VACCINATION_DELETED,
          entityType: AuditEntityType.VACCINATION,
          entityId: vaccinationId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId, vaccinationId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('vaccination.deleted', {
      vaccinationId,
      animalId,
      organizationId,
    });
  }

  /** Clinic-wide list (legacy `getClinicVaccinations`) — only animals with ACTIVE access. */
  async listClinicWide(
    organizationId: string,
    filter: { page: number; pageSize: number; status: ClinicVaccinationListStatus },
  ): Promise<{ items: ClinicVaccinationDTO[]; total: number }> {
    const { items, total } = await this.vaccinations.listForClinic(organizationId, filter);
    const today = businessToday();
    return {
      items: items.map((x) => ({
        vaccination: toVaccinationDTO(x.vaccination),
        animal: x.animal,
        owner: x.owner,
        isOverdue:
          x.vaccination.status === 'SCHEDULED' &&
          x.vaccination.nextDueOn !== null &&
          x.vaccination.nextDueOn < today,
      })),
      total,
    };
  }

  /**
   * "إرسال إشعار" (legacy `sendVaccinationNotification`): remind the current
   * owner about this clinic's vaccination. Repeatable; audited.
   */
  async notifyOwner(
    organizationId: string,
    animalId: string,
    vaccinationId: string,
    actor: VetCareActor,
  ): Promise<{ notified: boolean }> {
    const existing = await this.vaccinations.findByIdForAnimal(vaccinationId, animalId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Vaccination not found');
    }
    const petOwnerUserId = await this.ownerships.currentOwnerUserId(animalId);
    if (!petOwnerUserId) return { notified: false };
    await this.audit.record({
      action: AuditAction.VACCINATION_OWNER_NOTIFIED,
      entityType: AuditEntityType.VACCINATION,
      entityId: vaccinationId,
      actorUserId: actor.actorUserId,
      metadata: { organizationId, animalId, vaccinationId },
      context: actor.context,
    });
    this.events.publish('vaccination.owner_notified', {
      vaccinationId,
      animalId,
      organizationId,
      petOwnerUserId,
      actorUserId: actor.actorUserId,
      sentAt: new Date().toISOString(),
    });
    return { notified: true };
  }

  // --- owner-facing (read-only) ------------------------------------

  async listForOwner(
    animalId: string,
    filter: ListVaccinationsFilter,
  ): Promise<{ items: VaccinationDTO[]; total: number }> {
    const { items, total } = await this.vaccinations.listForAnimal(animalId, filter);
    return { items: items.map(toOwnerVaccinationDTO), total };
  }

  async getForOwner(animalId: string, vaccinationId: string): Promise<VaccinationDTO> {
    const v = await this.vaccinations.findByIdForAnimal(vaccinationId, animalId);
    if (!v) throw new NotFoundError('Vaccination not found');
    return toOwnerVaccinationDTO(v);
  }
}
