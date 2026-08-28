import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { InternalError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AnimalRepository } from '../../animals/infrastructure/animal.repository.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import {
  toMedicalRecordDTO,
  toOwnerMedicalRecordDTO,
  type CreateMedicalRecordInput,
  type MedicalRecordDTO,
  type UpdateMedicalRecordInput,
} from '../domain/veterinary-care.types.js';
import type { MedicalRecordRepository } from '../infrastructure/medical-record.repository.js';

export interface VetCareActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Medical records are the ANIMAL's shared veterinary history:
 *  - a clinic with an ACTIVE veterinary-access grant reads the animal's COMPLETE
 *    history (every clinic's entries — docs 01 §1.3.3);
 *  - a clinic may create / update / delete only entries IT recorded
 *    (`organization_id` match) — no clinic can alter another's records;
 *  - records are never owned by the recording veterinarian and survive
 *    membership / ownership changes untouched.
 */
export class MedicalRecordService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly records: MedicalRecordRepository,
    private readonly animals: AnimalRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'medical-record-service' });
  }

  // --- clinic-facing --------------------------------------------------

  async createForClinic(
    organizationId: string,
    animal: { id: string; status: string },
    input: CreateMedicalRecordInput,
    actor: VetCareActor,
  ): Promise<MedicalRecordDTO> {
    VeterinaryCarePolicy.assertAnimalActive(animal);

    const record = await this.db.transaction(async (tx) => {
      const created = await this.records.create(
        {
          animalId: animal.id,
          organizationId,
          recordedByUserId: actor.actorUserId,
          visitDate: input.visitDate ?? null,
          reason: input.reason ?? null,
          diagnosis: input.diagnosis ?? null,
          treatment: input.treatment ?? null,
          notes: input.notes ?? null,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.MEDICAL_RECORD_CREATED,
          entityType: AuditEntityType.MEDICAL_RECORD,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId: animal.id, medicalRecordId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('medical_record.created', {
      medicalRecordId: record.id,
      animalId: animal.id,
      organizationId,
    });
    return toMedicalRecordDTO(record);
  }

  async getForClinic(animalId: string, recordId: string): Promise<MedicalRecordDTO> {
    const record = await this.records.findByIdForAnimal(recordId, animalId);
    if (!record) throw new NotFoundError('Medical record not found');
    return toMedicalRecordDTO(record);
  }

  async listForClinic(
    animalId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: MedicalRecordDTO[]; total: number }> {
    const { items, total } = await this.records.listForAnimal(animalId, filter);
    return { items: items.map(toMedicalRecordDTO), total };
  }

  async updateForClinic(
    organizationId: string,
    animalId: string,
    recordId: string,
    patch: UpdateMedicalRecordInput,
    actor: VetCareActor,
  ): Promise<MedicalRecordDTO> {
    const existing = await this.records.findByIdForAnimal(recordId, animalId);
    // Hide records that belong to a different clinic behind the same 404.
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Medical record not found');
    }
    const animal = await this.animals.findById(animalId);
    if (!animal) throw new InternalError('animal missing for an existing medical record');
    VeterinaryCarePolicy.assertAnimalActive(animal);

    const updated = await this.db.transaction(async (tx) => {
      const rec = await this.records.update(
        recordId,
        {
          visitDate: patch.visitDate,
          reason: patch.reason,
          diagnosis: patch.diagnosis,
          treatment: patch.treatment,
          notes: patch.notes,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.MEDICAL_RECORD_UPDATED,
          entityType: AuditEntityType.MEDICAL_RECORD,
          entityId: recordId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            animalId,
            medicalRecordId: recordId,
            fields: Object.keys(patch),
          },
          context: actor.context,
        },
        tx,
      );
      return rec;
    });

    this.events.publish('medical_record.updated', {
      medicalRecordId: recordId,
      animalId,
      organizationId,
    });
    return toMedicalRecordDTO(updated);
  }

  async deleteForClinic(
    organizationId: string,
    animalId: string,
    recordId: string,
    actor: VetCareActor,
  ): Promise<void> {
    const existing = await this.records.findByIdForAnimal(recordId, animalId);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Medical record not found');
    }

    await this.db.transaction(async (tx) => {
      const deleted = await this.records.deleteById(recordId, tx);
      if (deleted !== 1) throw new NotFoundError('Medical record not found');
      await this.audit.record(
        {
          action: AuditAction.MEDICAL_RECORD_DELETED,
          entityType: AuditEntityType.MEDICAL_RECORD,
          entityId: recordId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, animalId, medicalRecordId: recordId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('medical_record.deleted', {
      medicalRecordId: recordId,
      animalId,
      organizationId,
    });
  }

  // --- owner-facing (read-only) ------------------------------------

  async listForOwner(
    animalId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: MedicalRecordDTO[]; total: number }> {
    const { items, total } = await this.records.listForAnimal(animalId, filter);
    return { items: items.map(toOwnerMedicalRecordDTO), total };
  }

  async getForOwner(animalId: string, recordId: string): Promise<MedicalRecordDTO> {
    const record = await this.records.findByIdForAnimal(recordId, animalId);
    if (!record) throw new NotFoundError('Medical record not found');
    return toOwnerMedicalRecordDTO(record);
  }
}
