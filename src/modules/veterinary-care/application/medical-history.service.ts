import type { Logger } from 'pino';
import {
  medicalRecordToTimelineEntry,
  sortTimelineEntries,
  toMedicalRecordDTO,
  toOwnerVaccinationDTO,
  toVaccinationDTO,
  vaccinationToTimelineEntry,
  type MedicalTimelineEntryDTO,
  type MedicalTimelineEntryType,
} from '../domain/veterinary-care.types.js';
import type { MedicalRecordRepository } from '../infrastructure/medical-record.repository.js';
import type { VaccinationRepository } from '../infrastructure/vaccination.repository.js';
import type { MedicalAttachments } from './medical-attachments.js';

export interface TimelineFilter {
  page: number;
  pageSize: number;
  /** Optional discriminator filter — only records, or only vaccinations. */
  type?: MedicalTimelineEntryType;
}

/**
 * Read-only composed view of an animal's medical history, merged newest-first.
 * No new storage. The two views differ by visibility, not just shape:
 *
 *  - CLINIC: `medical_records` ∪ `vaccinations` authored by THAT clinic only;
 *  - OWNER:  `vaccinations` only (every clinic's) — medical records are
 *    clinic-private and never part of the owner's history.
 *
 * Route access (clinic: `authorizeOrg('medical_record.read')`; owner:
 * `authorizeAnimalRead`) is enforced by the caller's route.
 */
export class MedicalHistoryService {
  private readonly log: Logger;

  // Medical history per animal is small; fetch a generous slice of each table
  // and paginate the merged result in memory. Documented ceiling.
  private static readonly PER_TABLE_CEILING = 1000;

  constructor(
    private readonly records: MedicalRecordRepository,
    private readonly vaccinations: VaccinationRepository,
    private readonly attachments: MedicalAttachments,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'medical-history-service' });
  }

  /** The clinic's OWN records + vaccinations for the animal. */
  timelineForClinic(
    organizationId: string,
    animalId: string,
    filter: TimelineFilter,
  ): Promise<{ items: MedicalTimelineEntryDTO[]; total: number }> {
    return this.buildTimeline(animalId, filter, { organizationId });
  }

  /** The owner's view: vaccinations only (clinic records are private). */
  timelineForOwner(
    animalId: string,
    filter: TimelineFilter,
  ): Promise<{ items: MedicalTimelineEntryDTO[]; total: number }> {
    return this.buildTimeline(animalId, filter, { owner: true });
  }

  private async buildTimeline(
    animalId: string,
    filter: TimelineFilter,
    scope: { organizationId: string; owner?: never } | { owner: true; organizationId?: never },
  ): Promise<{ items: MedicalTimelineEntryDTO[]; total: number }> {
    const ownerView = scope.owner === true;
    const wantRecords =
      !ownerView && (filter.type === undefined || filter.type === 'MEDICAL_RECORD');
    const wantVaccinations = filter.type === undefined || filter.type === 'VACCINATION';
    const ceil = MedicalHistoryService.PER_TABLE_CEILING;
    const organizationId = scope.organizationId;

    const [rec, vax] = await Promise.all([
      wantRecords
        ? this.records.listForAnimal(animalId, { page: 1, pageSize: ceil, organizationId })
        : Promise.resolve({ items: [], total: 0 }),
      wantVaccinations
        ? this.vaccinations.listForAnimal(animalId, { page: 1, pageSize: ceil, organizationId })
        : Promise.resolve({ items: [], total: 0 }),
    ]);

    const entries = sortTimelineEntries([
      ...(await Promise.all(
        rec.items.map(async (r) =>
          medicalRecordToTimelineEntry(toMedicalRecordDTO(r, await this.attachments.resolve(r))),
        ),
      )),
      ...vax.items.map((v) =>
        vaccinationToTimelineEntry(ownerView ? toOwnerVaccinationDTO(v) : toVaccinationDTO(v)),
      ),
    ]);

    const total = rec.total + vax.total;
    const start = (filter.page - 1) * filter.pageSize;
    return { items: entries.slice(start, start + filter.pageSize), total };
  }
}
