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
  type CreateMedicalRecordInput,
  type MedicalRecord,
  type MedicalRecordDTO,
  type UpdateMedicalRecordInput,
} from '../domain/veterinary-care.types.js';
import type { MedicalRecordRepository } from '../infrastructure/medical-record.repository.js';
import type { MedicalAttachments } from './medical-attachments.js';

export interface VetCareActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Medical records are CLINIC-PRIVATE:
 *  - a clinic reads, updates and deletes only the records IT created
 *    (`organization_id` match) — another clinic's record is the same `404` as
 *    an unknown id, for every read and write (IDOR-safe: the clinic is the
 *    authorized URL organization, never a client-supplied value);
 *  - the pet owner never sees them (no owner route exists);
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
    private readonly attachments: MedicalAttachments,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'medical-record-service' });
  }

  private async dto(record: MedicalRecord): Promise<MedicalRecordDTO> {
    return toMedicalRecordDTO(record, await this.attachments.resolve(record));
  }

  /** Presigned upload for a prescription photo / attachment of this clinic. */
  requestAttachmentUploadUrl(
    organizationId: string,
    input: { filename: string; mimeType: string; size: number },
  ): ReturnType<MedicalAttachments['requestUploadUrl']> {
    return this.attachments.requestUploadUrl(organizationId, input);
  }

  // --- clinic-facing --------------------------------------------------

  async createForClinic(
    organizationId: string,
    animal: { id: string; status: string },
    input: CreateMedicalRecordInput,
    actor: VetCareActor,
  ): Promise<MedicalRecordDTO> {
    VeterinaryCarePolicy.assertAnimalActive(animal);
    await this.attachments.assertUsable(organizationId, [
      ...(input.prescriptionKey ? [input.prescriptionKey] : []),
      ...(input.attachmentKeys ?? []),
    ]);

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
          symptoms: input.symptoms ?? null,
          severity: input.severity ?? null,
          labNotes: input.labNotes ?? null,
          recordType: input.recordType ?? 'GENERAL',
          isDraft: input.isDraft ?? false,
          prescriptionKey: input.prescriptionKey ?? null,
          attachmentKeys: input.attachmentKeys ?? [],
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
      isDraft: record.isDraft,
      actorUserId: actor.actorUserId,
    });
    return this.dto(record);
  }

  async getForClinic(
    organizationId: string,
    animalId: string,
    recordId: string,
  ): Promise<MedicalRecordDTO> {
    const record = await this.records.findByIdForAnimal(recordId, animalId);
    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundError('Medical record not found');
    }
    return this.dto(record);
  }

  /** This clinic's records for the animal — never another clinic's. */
  async listForClinic(
    organizationId: string,
    animalId: string,
    filter: { page: number; pageSize: number },
  ): Promise<{ items: MedicalRecordDTO[]; total: number }> {
    const { items, total } = await this.records.listForAnimal(animalId, {
      ...filter,
      organizationId,
    });
    return { items: await Promise.all(items.map((r) => this.dto(r))), total };
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
    const alreadyAttached = [
      ...(existing.prescriptionKey ? [existing.prescriptionKey] : []),
      ...existing.attachmentKeys,
    ];
    await this.attachments.assertUsable(
      organizationId,
      [...(patch.prescriptionKey ? [patch.prescriptionKey] : []), ...(patch.attachmentKeys ?? [])],
      alreadyAttached,
    );

    const updated = await this.db.transaction(async (tx) => {
      const rec = await this.records.update(
        recordId,
        {
          visitDate: patch.visitDate,
          reason: patch.reason,
          diagnosis: patch.diagnosis,
          treatment: patch.treatment,
          notes: patch.notes,
          symptoms: patch.symptoms,
          severity: patch.severity,
          labNotes: patch.labNotes,
          recordType: patch.recordType,
          isDraft: patch.isDraft,
          prescriptionKey: patch.prescriptionKey,
          attachmentKeys: patch.attachmentKeys,
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
      finalized: existing.isDraft && !updated.isDraft,
      actorUserId: actor.actorUserId,
    });
    const stillAttached = new Set([
      ...(updated.prescriptionKey ? [updated.prescriptionKey] : []),
      ...updated.attachmentKeys,
    ]);
    await this.attachments.deleteQuietly(alreadyAttached.filter((k) => !stillAttached.has(k)));
    return this.dto(updated);
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
    await this.attachments.deleteQuietly([
      ...(existing.prescriptionKey ? [existing.prescriptionKey] : []),
      ...existing.attachmentKeys,
    ]);
  }
}
