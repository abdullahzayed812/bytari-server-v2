import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  acceptTransferRequest,
  bearer,
  cancelTransferRequest,
  createAnimal,
  createTransferRequest,
  registerAdmin,
  registerUser,
  rejectTransferRequest,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('animal transfer requests — create (owner-only)', () => {
  it('the owner requests a transfer to another user; it starts PENDING', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await createTransferRequest(
      app,
      owner.accessToken,
      animal.id,
      recipient.id,
      'moving abroad',
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      reason: 'moving abroad',
      fromUser: { id: owner.id },
      toUser: { id: recipient.id },
      animal: { id: animal.id },
    });

    // ownership has not moved yet
    const getAnimal = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(getAnimal.body.data.currentOwnerUserId).toBe(owner.id);
  });

  it('rejects a non-owner creating a transfer request (404 — hides existence)', async () => {
    const owner = await registerUser(app);
    const attacker = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await createTransferRequest(app, attacker.accessToken, animal.id, recipient.id);
    expect(res.status).toBe(404);
    expect(await getTestDb()('animal_transfer_requests')).toHaveLength(0);
  });

  it('rejects targeting yourself, a suspended user, or an unknown user id', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const self = await createTransferRequest(app, owner.accessToken, animal.id, owner.id);
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('INVALID_TRANSFER_TARGET');

    const unknown = await createTransferRequest(
      app,
      owner.accessToken,
      animal.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(unknown.status).toBe(404);

    const suspended = await registerUser(app);
    await getTestDb()('users').where({ id: suspended.id }).update({ status: 'SUSPENDED' });
    const inactive = await createTransferRequest(app, owner.accessToken, animal.id, suspended.id);
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('INVALID_TRANSFER_TARGET');
  });

  it('rejects unknown/forged fields in the create body (422, strict schema)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/transfer-requests`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: recipient.id, status: 'ACCEPTED', fromUserId: recipient.id });
    expect(res.status).toBe(422);
    expect(await getTestDb()('animal_transfer_requests')).toHaveLength(0);
  });

  it('rejects requesting a transfer for a deactivated animal (409)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(owner.accessToken));

    const res = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ANIMAL_NOT_ACTIVE');
  });

  it('rejects a second open request for the same animal (409) — a different recipient is still refused', async () => {
    const owner = await registerUser(app);
    const recipient1 = await registerUser(app);
    const recipient2 = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const first = await createTransferRequest(app, owner.accessToken, animal.id, recipient1.id);
    expect(first.status).toBe(201);

    const dup = await createTransferRequest(app, owner.accessToken, animal.id, recipient2.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TRANSFER_REQUEST_ALREADY_OPEN');
  });

  it('rejects an invalid body (422)', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/transfer-requests`)
      .set(bearer(owner.accessToken))
      .send({ toUserId: 'not-a-uuid' });
    expect(res.status).toBe(422);
  });
});

describe('animal transfer requests — sent / received lists', () => {
  it("lists appear in the sender's sent list and the recipient's received list only", async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const sent = await request(app)
      .get('/api/v1/animal-transfer-requests/sent')
      .set(bearer(owner.accessToken));
    expect(sent.body.data.map((r: { id: string }) => r.id)).toEqual([created.body.data.id]);

    const received = await request(app)
      .get('/api/v1/animal-transfer-requests/received')
      .set(bearer(recipient.accessToken));
    expect(received.body.data.map((r: { id: string }) => r.id)).toEqual([created.body.data.id]);

    // the sender's sent list is empty for the recipient, and vice versa
    const recipientSent = await request(app)
      .get('/api/v1/animal-transfer-requests/sent')
      .set(bearer(recipient.accessToken));
    expect(recipientSent.body.data).toHaveLength(0);
    const ownerReceived = await request(app)
      .get('/api/v1/animal-transfer-requests/received')
      .set(bearer(owner.accessToken));
    expect(ownerReceived.body.data).toHaveLength(0);

    // an unrelated third party sees neither
    const strangerSent = await request(app)
      .get('/api/v1/animal-transfer-requests/sent')
      .set(bearer(stranger.accessToken));
    expect(strangerSent.body.data).toHaveLength(0);
  });

  it('GET /:id 404s for a caller who is neither the sender nor the recipient', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);
    const id = created.body.data.id;

    const asStranger = await request(app)
      .get(`/api/v1/animal-transfer-requests/${id}`)
      .set(bearer(stranger.accessToken));
    expect(asStranger.status).toBe(404);

    const asSender = await request(app)
      .get(`/api/v1/animal-transfer-requests/${id}`)
      .set(bearer(owner.accessToken));
    expect(asSender.status).toBe(200);
    const asRecipient = await request(app)
      .get(`/api/v1/animal-transfer-requests/${id}`)
      .set(bearer(recipient.accessToken));
    expect(asRecipient.status).toBe(200);
  });
});

describe('animal transfer requests — accept (ownership actually moves)', () => {
  it('the recipient accepts → ownership transfers atomically and the request is ACCEPTED', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(
      app,
      owner.accessToken,
      animal.id,
      recipient.id,
      'gift',
    );
    const id = created.body.data.id;

    const res = await acceptTransferRequest(app, recipient.accessToken, id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACCEPTED');

    const getAnimal = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(recipient.accessToken));
    expect(getAnimal.body.data.currentOwnerUserId).toBe(recipient.id);

    const history = await request(app)
      .get(`/api/v1/animals/${animal.id}/ownership/history`)
      .set(bearer(recipient.accessToken));
    const rows = history.body.data as Array<{
      ownerUserId: string;
      isCurrent: boolean;
      transferredBy: string | null;
      transferReason: string | null;
    }>;
    expect(rows).toHaveLength(2);
    const current = rows.find((r) => r.isCurrent);
    expect(current).toMatchObject({
      ownerUserId: recipient.id,
      transferredBy: owner.id,
      transferReason: 'gift',
    });
  });

  it('only the recipient may accept — the sender gets 403', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const res = await acceptTransferRequest(app, owner.accessToken, created.body.data.id);
    expect(res.status).toBe(403);
  });

  it('an unrelated user gets 404 trying to accept (hides existence)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const res = await acceptTransferRequest(app, stranger.accessToken, created.body.data.id);
    expect(res.status).toBe(404);
  });

  it('re-accepting an already-resolved request is a 409', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);
    await acceptTransferRequest(app, recipient.accessToken, created.body.data.id);

    const again = await acceptTransferRequest(app, recipient.accessToken, created.body.data.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TRANSFER_REQUEST_NOT_PENDING');
  });

  it('accepting a request for an animal deactivated in the meantime fails without corrupting state', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);
    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(owner.accessToken));

    const res = await acceptTransferRequest(app, recipient.accessToken, created.body.data.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ANIMAL_NOT_ACTIVE');

    // ownership never moved, and the request is still PENDING (nothing partially applied)
    const getAnimal = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(getAnimal.body.data.currentOwnerUserId).toBe(owner.id);
    const reread = await request(app)
      .get(`/api/v1/animal-transfer-requests/${created.body.data.id}`)
      .set(bearer(owner.accessToken));
    expect(reread.body.data.status).toBe('PENDING');
  });
});

describe('animal transfer requests — reject', () => {
  it('the recipient rejects with a reason; ownership is untouched', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const res = await rejectTransferRequest(
      app,
      recipient.accessToken,
      created.body.data.id,
      'not interested',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'REJECTED', responseReason: 'not interested' });

    const getAnimal = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(getAnimal.body.data.currentOwnerUserId).toBe(owner.id);
  });

  it('only the recipient may reject — the sender gets 403', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const res = await rejectTransferRequest(app, owner.accessToken, created.body.data.id);
    expect(res.status).toBe(403);
  });

  it('a rejected request can be superseded by a new one for the same animal', async () => {
    const owner = await registerUser(app);
    const recipient1 = await registerUser(app);
    const recipient2 = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const first = await createTransferRequest(app, owner.accessToken, animal.id, recipient1.id);
    await rejectTransferRequest(app, recipient1.accessToken, first.body.data.id);

    const second = await createTransferRequest(app, owner.accessToken, animal.id, recipient2.id);
    expect(second.status).toBe(201);
  });
});

describe('animal transfer requests — cancel', () => {
  it('the sender cancels their own pending request; a new one can then be sent', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const res = await cancelTransferRequest(app, owner.accessToken, created.body.data.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');

    const again = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);
    expect(again.status).toBe(201);
  });

  it('only the sender may cancel — the recipient gets 403', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const res = await cancelTransferRequest(app, recipient.accessToken, created.body.data.id);
    expect(res.status).toBe(403);
  });

  it('the recipient cannot accept a CANCELLED request (409)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);
    await cancelTransferRequest(app, owner.accessToken, created.body.data.id);

    const res = await acceptTransferRequest(app, recipient.accessToken, created.body.data.id);
    expect(res.status).toBe(409);
  });
});

describe('animal transfer requests — ADMIN', () => {
  it('an ADMIN may create a request on the owner’s behalf (same override as the instant transfer endpoint)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);

    const createAsAdmin = await createTransferRequest(
      app,
      admin.accessToken,
      animal.id,
      recipient.id,
    );
    expect(createAsAdmin.status).toBe(201);
  });

  it('an ADMIN cannot accept or reject on the recipient’s behalf — acceptance is personal consent, not a management action (404)', async () => {
    const owner = await registerUser(app);
    const recipient = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);
    const created = await createTransferRequest(app, owner.accessToken, animal.id, recipient.id);

    const acceptAsAdmin = await acceptTransferRequest(app, admin.accessToken, created.body.data.id);
    expect(acceptAsAdmin.status).toBe(404);
    const rejectAsAdmin = await rejectTransferRequest(app, admin.accessToken, created.body.data.id);
    expect(rejectAsAdmin.status).toBe(404);
  });
});
