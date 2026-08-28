import type { Logger } from 'pino';
import {
  medicalRecordToTimelineEntry,
  sortTimelineEntries,
  toMedicalRecordDTO,
  toOwnerMedicalRecordDTO,
  toOwnerVaccinationDTO,
  toVaccinationDTO,
  vaccinationToTimelineEntry,
  type MedicalTimelineEntryDTO,
  type MedicalTimelineEntryType,
} from '../domain/veterinary-care.types.js';
import type { MedicalRecordRepository } from '../infrastructure/medical-record.repository.js';
import type { VaccinationRepository } from '../infrastructure/vaccination.repository.js';

export interface TimelineFilter {
  page: number;
  pageSize: number;
  /** Optional discriminator filter — only records, or only vaccinations. */
  type?: MedicalTimelineEntryType;
}

/**
 * Read-only composed view of an animal's medical history: `medical_records`
 * ∪ `vaccinations`, merged newest-first. No new storage — it just reshapes the
 * two Phase-5 tables into one chronological list (docs 04 §4.4 / §4.5). Access
 * is gated by the caller's route (clinic: `authorizeOrg('medical_record.read')`
 * + veterinary-access grant; owner: `authorizeAnimalRead`), exactly like the
 * underlying list endpoints — this service performs no authorization itself.
 */
export class MedicalHistoryService {
  private readonly log: Logger;

  // Medical history per animal is small; fetch a generous slice of each table
  // and paginate the merged result in memory. Documented ceiling.
  private static readonly PER_TABLE_CEILING = 1000;

  constructor(
    private readonly records: MedicalRecordRepository,
    private readonly vaccinations: VaccinationRepository,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'medical-history-service' });
  }

  timelineForClinic(
    animalId: string,
    filter: TimelineFilter,
  ): Promise<{ items: MedicalTimelineEntryDTO[]; total: number }> {
    return this.buildTimeline(animalId, filter, false);
  }

  timelineForOwner(
    animalId: string,
    filter: TimelineFilter,
  ): Promise<{ items: MedicalTimelineEntryDTO[]; total: number }> {
    return this.buildTimeline(animalId, filter, true);
  }

  private async buildTimeline(
    animalId: string,
    filter: TimelineFilter,
    ownerView: boolean,
  ): Promise<{ items: MedicalTimelineEntryDTO[]; total: number }> {
    const wantRecords = filter.type === undefined || filter.type === 'MEDICAL_RECORD';
    const wantVaccinations = filter.type === undefined || filter.type === 'VACCINATION';
    const ceil = MedicalHistoryService.PER_TABLE_CEILING;

    const [rec, vax] = await Promise.all([
      wantRecords
        ? this.records.listForAnimal(animalId, { page: 1, pageSize: ceil })
        : Promise.resolve({ items: [], total: 0 }),
      wantVaccinations
        ? this.vaccinations.listForAnimal(animalId, { page: 1, pageSize: ceil })
        : Promise.resolve({ items: [], total: 0 }),
    ]);

    const entries = sortTimelineEntries([
      ...rec.items.map((r) =>
        medicalRecordToTimelineEntry(
          ownerView ? toOwnerMedicalRecordDTO(r) : toMedicalRecordDTO(r),
        ),
      ),
      ...vax.items.map((v) =>
        vaccinationToTimelineEntry(ownerView ? toOwnerVaccinationDTO(v) : toVaccinationDTO(v)),
      ),
    ]);

    const total = rec.total + vax.total;
    const start = (filter.page - 1) * filter.pageSize;
    return { items: entries.slice(start, start + filter.pageSize), total };
  }
}
