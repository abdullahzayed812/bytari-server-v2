import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createAnimal,
  createMedicalRecord,
  grantVeterinaryAccess,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

const captured: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (
    e.name.startsWith('medical_record.') ||
    e.name.startsWith('vaccination.') ||
    e.name.startsWith('veterinary_access.')
  ) {
    captured.push(e.name);
  }
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  captured.length = 0;
});
afterAll(() => closeTestDb());

async function setup() {
  const admin = await registerAdmin(app);
  const clinicOwner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const petOwner = await registerUser(app);
  const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Audit Clinic',
  });
  await addOrganizationMember(app, clinicOwner.accessToken, clinic.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  const animal = await createAnimal(app, petOwner.accessToken);
  return { admin, clinicOwner, vet, petOwner, clinic, animal };
}

async function auditRows(
  entityId: string,
): Promise<
  Array<{ action: string; actor_user_id: string | null; metadata: Record<string, unknown> }>
> {
  return getTestDb()('audit_logs')
    .where({ entity_id: entityId })
    .orderBy('created_at', 'asc')
    .select('action', 'actor_user_id', 'metadata');
}

describe('veterinary-care events + audit', () => {
  it('grant → audit ANIMAL_CLINIC_ACCESS_GRANTED + event after commit', async () => {
    const { clinicOwner, clinic, animal } = await setup();
    const grant = await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
    await tick();

    expect(captured).toContain('veterinary_access.granted');
    const rows = await auditRows(grant.id);
    expect(rows.map((r) => r.action)).toContain('ANIMAL_CLINIC_ACCESS_GRANTED');
    expect(rows[0]?.actor_user_id).toBe(clinicOwner.id);
    expect(rows[0]?.metadata).toMatchObject({ organizationId: clinic.id, animalId: animal.id });
  });

  it('medical record create/update/delete emit events and write audit with the acting vet', async () => {
    const { clinicOwner, vet, clinic, animal } = await setup();
    await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
    captured.length = 0;

    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    await request(app)
      .patch(`/api/v1/organizations/${clinic.id}/animals/${animal.id}/medical-records/${rec.id}`)
      .set(bearer(vet.accessToken))
      .send({ notes: 'update' });
    await request(app)
      .delete(`/api/v1/organizations/${clinic.id}/animals/${animal.id}/medical-records/${rec.id}`)
      .set(bearer(vet.accessToken));
    await tick();

    expect(captured).toEqual(
      expect.arrayContaining([
        'medical_record.created',
        'medical_record.updated',
        'medical_record.deleted',
      ]),
    );
    const rows = await auditRows(rec.id);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual([
      'MEDICAL_RECORD_CREATED',
      'MEDICAL_RECORD_UPDATED',
      'MEDICAL_RECORD_DELETED',
    ]);
    for (const r of rows) {
      expect(r.actor_user_id).toBe(vet.id);
      expect(r.metadata).toMatchObject({ organizationId: clinic.id, animalId: animal.id });
    }
  });

  it('a failed create (no access grant) writes no audit and emits no event', async () => {
    const { vet, clinic, animal } = await setup();
    captured.length = 0;

    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/animals/${animal.id}/medical-records`)
      .set(bearer(vet.accessToken))
      .send({ diagnosis: 'x' });
    await tick();

    expect(res.status).toBe(404);
    expect(captured).toHaveLength(0);
    const anyMedicalAudit = await getTestDb()('audit_logs')
      .whereIn('action', ['MEDICAL_RECORD_CREATED'])
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(anyMedicalAudit?.count ?? 0)).toBe(0);
  });

  it('does not leak secrets into veterinary-care audit metadata', async () => {
    const { clinicOwner, vet, clinic, animal } = await setup();
    await grantVeterinaryAccess(app, clinicOwner.accessToken, clinic.id, animal.id);
    const rec = await createMedicalRecord(app, vet.accessToken, clinic.id, animal.id);
    const blob = JSON.stringify(await auditRows(rec.id));
    expect(blob.toLowerCase()).not.toContain('password');
    expect(blob).not.toContain(vet.accessToken);
  });
});
