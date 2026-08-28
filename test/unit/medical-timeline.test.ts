import { describe, expect, it } from 'vitest';
import {
  medicalRecordToTimelineEntry,
  sortTimelineEntries,
  vaccinationToTimelineEntry,
  type MedicalRecordDTO,
  type VaccinationDTO,
} from '../../src/modules/veterinary-care/domain/veterinary-care.types.js';

const rec = (id: string, visitDate: string, createdAt: string): MedicalRecordDTO => ({
  id,
  animalId: 'a1',
  organizationId: 'o1',
  recordedByUserId: 'u1',
  visitDate,
  reason: null,
  diagnosis: null,
  treatment: null,
  notes: null,
  createdAt,
  updatedAt: createdAt,
});

const vax = (id: string, administeredOn: string, createdAt: string): VaccinationDTO => ({
  id,
  animalId: 'a1',
  organizationId: 'o1',
  recordedByUserId: 'u1',
  vaccineName: 'V',
  administeredOn,
  nextDueOn: null,
  notes: null,
  createdAt,
  updatedAt: createdAt,
});

describe('medical timeline composition', () => {
  it('maps a record and a vaccination to discriminated entries', () => {
    const r = medicalRecordToTimelineEntry(rec('r1', '2026-01-01', '2026-01-01T00:00:00.000Z'));
    expect(r).toMatchObject({ type: 'MEDICAL_RECORD', occurredOn: '2026-01-01' });
    expect(r.medicalRecord?.id).toBe('r1');
    expect(r.vaccination).toBeUndefined();

    const v = vaccinationToTimelineEntry(vax('v1', '2026-02-02', '2026-02-02T00:00:00.000Z'));
    expect(v).toMatchObject({ type: 'VACCINATION', occurredOn: '2026-02-02' });
    expect(v.vaccination?.id).toBe('v1');
    expect(v.medicalRecord).toBeUndefined();
  });

  it('sorts newest-first by occurredOn, then createdAt as a stable tie-break', () => {
    const entries = [
      medicalRecordToTimelineEntry(rec('r-old', '2026-01-01', '2026-01-01T09:00:00.000Z')),
      vaccinationToTimelineEntry(vax('v-new', '2026-03-01', '2026-03-01T09:00:00.000Z')),
      medicalRecordToTimelineEntry(rec('r-mid-a', '2026-02-01', '2026-02-01T08:00:00.000Z')),
      vaccinationToTimelineEntry(vax('v-mid-b', '2026-02-01', '2026-02-01T10:00:00.000Z')),
    ];
    const sorted = sortTimelineEntries(entries);
    const ids = sorted.map((e) => e.medicalRecord?.id ?? e.vaccination?.id);
    expect(ids).toEqual(['v-new', 'v-mid-b', 'r-mid-a', 'r-old']);
  });

  it('does not mutate the input array', () => {
    const input = [
      medicalRecordToTimelineEntry(rec('a', '2026-01-01', '2026-01-01T00:00:00.000Z')),
      vaccinationToTimelineEntry(vax('b', '2026-02-01', '2026-02-01T00:00:00.000Z')),
    ];
    const copy = [...input];
    sortTimelineEntries(input);
    expect(input).toEqual(copy);
  });
});
