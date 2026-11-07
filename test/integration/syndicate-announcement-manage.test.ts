import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createSyndicate,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/syndicates${p}`;

type User = Awaited<ReturnType<typeof registerUser>>;

/**
 * Two syndicates (A, B), each with one announcement, and a syndicate
 * supervisor assigned (via "إضافة مسؤول نقابة") to syndicate A only.
 */
async function setup(): Promise<{
  admin: User;
  supervisor: User;
  syndicateA: string;
  syndicateB: string;
  annA: string;
  annB: string;
}> {
  const admin = await registerAdmin(app);
  const a = await createSyndicate(app, admin.accessToken, { name: 'نقابة أ' });
  const b = await createSyndicate(app, admin.accessToken, { name: 'نقابة ب' });
  const supervisor = await registerUser(app);
  const assigned = await request(app)
    .post(api(`/${a.id}/admins`))
    .set(bearer(admin.accessToken))
    .send({ email: supervisor.email });
  expect(assigned.status).toBe(201);

  const create = async (orgId: string, title: string): Promise<string> => {
    const res = await request(app)
      .post(api(`/${orgId}/announcements`))
      .set(bearer(admin.accessToken))
      .send({ type: 'ANNOUNCEMENT', title, body: 'نص الإعلان' });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  };
  return {
    admin,
    supervisor,
    syndicateA: a.id,
    syndicateB: b.id,
    annA: await create(a.id, 'إعلان أ'),
    annB: await create(b.id, 'إعلان ب'),
  };
}

async function titleOf(id: string): Promise<string | undefined> {
  const row = await getTestDb()('syndicate_announcements').where({ id }).first('title');
  return row?.title as string | undefined;
}

describe('syndicate announcements — edit / delete by Admin and syndicate supervisors', () => {
  it('the ADMIN can edit and delete announcements of any syndicate (audited)', async () => {
    const { admin, syndicateA, syndicateB, annA, annB } = await setup();

    const edit = await request(app)
      .patch(api(`/${syndicateB}/announcements/${annB}`))
      .set(bearer(admin.accessToken))
      .send({ title: 'عنوان معدّل', type: 'IMPORTANT_NOTICE' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ title: 'عنوان معدّل', type: 'IMPORTANT_NOTICE' });

    const del = await request(app)
      .delete(api(`/${syndicateA}/announcements/${annA}`))
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(204);
    expect(await titleOf(annA)).toBeUndefined();

    const audits = await getTestDb()('audit_logs')
      .whereIn('entity_id', [annA, annB])
      .whereIn('action', ['SYNDICATE_ANNOUNCEMENT_UPDATED', 'SYNDICATE_ANNOUNCEMENT_DELETED'])
      .select('action', 'entity_id', 'metadata');
    expect(audits).toHaveLength(2);
    const deleted = audits.find((r) => r.action === 'SYNDICATE_ANNOUNCEMENT_DELETED');
    expect(deleted?.metadata).toMatchObject({ organizationId: syndicateA, title: 'إعلان أ' });
    const updated = audits.find((r) => r.action === 'SYNDICATE_ANNOUNCEMENT_UPDATED');
    expect(updated?.metadata).toMatchObject({ organizationId: syndicateB });
  });

  it('a syndicate supervisor edits / deletes only their assigned syndicate’s announcements', async () => {
    const { supervisor, syndicateA, syndicateB, annA, annB } = await setup();

    const access = await request(app)
      .get(api(`/${syndicateA}/my-access`))
      .set(bearer(supervisor.accessToken));
    expect(access.body.data.canManageAnnouncements).toBe(true);
    const accessB = await request(app)
      .get(api(`/${syndicateB}/my-access`))
      .set(bearer(supervisor.accessToken));
    expect(accessB.body.data.canManageAnnouncements).toBe(false);

    const edit = await request(app)
      .patch(api(`/${syndicateA}/announcements/${annA}`))
      .set(bearer(supervisor.accessToken))
      .send({ body: 'نص جديد' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.body).toBe('نص جديد');

    // Other syndicate's route → 403 (no permission there).
    const editB = await request(app)
      .patch(api(`/${syndicateB}/announcements/${annB}`))
      .set(bearer(supervisor.accessToken))
      .send({ title: 'اختراق' });
    expect(editB.status).toBe(403);
    const delB = await request(app)
      .delete(api(`/${syndicateB}/announcements/${annB}`))
      .set(bearer(supervisor.accessToken));
    expect(delB.status).toBe(403);

    // B's announcement smuggled through A's route (where they DO have the key) → 404.
    const smuggledEdit = await request(app)
      .patch(api(`/${syndicateA}/announcements/${annB}`))
      .set(bearer(supervisor.accessToken))
      .send({ title: 'اختراق' });
    expect(smuggledEdit.status).toBe(404);
    const smuggledDel = await request(app)
      .delete(api(`/${syndicateA}/announcements/${annB}`))
      .set(bearer(supervisor.accessToken));
    expect(smuggledDel.status).toBe(404);
    expect(await titleOf(annB)).toBe('إعلان ب');

    const del = await request(app)
      .delete(api(`/${syndicateA}/announcements/${annA}`))
      .set(bearer(supervisor.accessToken));
    expect(del.status).toBe(204);
    expect(await titleOf(annA)).toBeUndefined();
  });

  it('a veterinarian with no role in the syndicate gets 403', async () => {
    const { syndicateA, annA } = await setup();
    const vet = await registerApprovedVet(app);
    const denied = await request(app)
      .patch(api(`/${syndicateA}/announcements/${annA}`))
      .set(bearer(vet.accessToken))
      .send({ title: 'عنوان مختلف' });
    expect(denied.status).toBe(403);
    const deniedDel = await request(app)
      .delete(api(`/${syndicateA}/announcements/${annA}`))
      .set(bearer(vet.accessToken));
    expect(deniedDel.status).toBe(403);
    expect(await titleOf(annA)).toBe('إعلان أ');
  });
});
