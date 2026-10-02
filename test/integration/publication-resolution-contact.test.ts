import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approvePublication,
  bearer,
  createAnimal,
  createAnimalPublication,
  createPublicationInteraction,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();
const API = '/api/v1';

const events: DomainEvent[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('animal.publication.')) events.push(e);
});

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  events.length = 0;
});
afterAll(() => closeTestDb());

async function approvedListing(kind: 'LOST' | 'ADOPTION' | 'MATING') {
  const admin = await registerAdmin(app);
  const owner = await registerUser(app);
  const animal = await createAnimal(app, owner.accessToken);
  const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind });
  await approvePublication(app, admin.accessToken, pub.id);
  return { admin, owner, animal, pub };
}

describe('adoption / mating / lost — outcome + owner ↔ interested-user contact', () => {
  it('a request opens an in-app conversation both parties (only) can use; the owner is notified', async () => {
    const { owner, pub } = await approvedListing('ADOPTION');
    const adopter = await registerUser(app);
    const stranger = await registerUser(app);

    const res = await createPublicationInteraction(app, adopter.accessToken, pub.id, {
      type: 'REQUEST',
      message: 'أرغب بتبنيه',
    });
    expect(res.status).toBe(201);
    const conversationId = res.body.data.conversationId as string;
    expect(conversationId).toBeTruthy();
    expect(
      events.find((e) => e.name === 'animal.publication.interaction.created')?.payload,
    ).toMatchObject({ publicationOwnerUserId: owner.id, conversationId });

    // both parties can talk in the existing chat
    const send = await request(app)
      .post(`${API}/conversations/${conversationId}/messages`)
      .set(bearer(owner.accessToken))
      .send({ body: 'أهلاً، متى يناسبك؟' });
    expect(send.status).toBe(201);
    const asAdopter = await request(app)
      .get(`${API}/conversations/${conversationId}/messages`)
      .set(bearer(adopter.accessToken));
    expect(asAdopter.status).toBe(200);
    expect(asAdopter.body.data).toHaveLength(1);

    // nobody else can read it
    const asStranger = await request(app)
      .get(`${API}/conversations/${conversationId}/messages`)
      .set(bearer(stranger.accessToken));
    expect(asStranger.status).toBe(404);

    // re-sending the request reuses the same conversation
    const again = await createPublicationInteraction(app, adopter.accessToken, pub.id, {
      type: 'REQUEST',
    });
    expect(again.body.data.conversationId).toBe(conversationId);
  });

  it('the owner sees every request; the requester sees theirs with the listing status', async () => {
    const { owner, pub } = await approvedListing('LOST');
    const finder = await registerUser(app);
    await createPublicationInteraction(app, finder.accessToken, pub.id, {
      type: 'SIGHTING',
      message: 'رأيته قرب السوق',
    });

    const ownerView = await request(app)
      .get(`${API}/animal-publications/${pub.id}/interactions`)
      .set(bearer(owner.accessToken));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data).toHaveLength(1);
    expect(ownerView.body.data[0]).toMatchObject({
      type: 'SIGHTING',
      requester: { id: finder.id },
    });
    // private: only the owner
    const notOwner = await request(app)
      .get(`${API}/animal-publications/${pub.id}/interactions`)
      .set(bearer(finder.accessToken));
    expect(notOwner.status).toBe(404);

    const mine = await request(app)
      .get(`${API}/animal-publications/interactions/mine`)
      .query({ kind: 'LOST' })
      .set(bearer(finder.accessToken));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].publication).toMatchObject({ id: pub.id, resolution: null });

    // the owner marks it FOUND → the requester sees the new status
    const found = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: 'FOUND' });
    expect(found.status).toBe(200);
    expect(found.body.data.resolution).toBe('FOUND');
    const mineAfter = await request(app)
      .get(`${API}/animal-publications/interactions/mine`)
      .set(bearer(finder.accessToken));
    expect(mineAfter.body.data[0].publication.resolution).toBe('FOUND');
  });

  it('a resolved listing STAYS in the public list (locked, with its outcome), refuses new requests, and can be reopened', async () => {
    const { owner, pub } = await approvedListing('ADOPTION');
    const viewer = await registerUser(app);

    const adopted = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: 'ADOPTED' });
    expect(adopted.status).toBe(200);

    const list = await request(app)
      .get(`${API}/animal-publications`)
      .query({ kind: 'ADOPTION' })
      .set(bearer(viewer.accessToken));
    const listed = (list.body.data as Array<{ id: string; resolution: string | null }>).find(
      (p) => p.id === pub.id,
    );
    expect(listed?.resolution).toBe('ADOPTED');
    // still reachable by id, with its outcome
    const detail = await request(app)
      .get(`${API}/animal-publications/${pub.id}`)
      .set(bearer(viewer.accessToken));
    expect(detail.body.data.resolution).toBe('ADOPTED');

    const blocked = await createPublicationInteraction(app, viewer.accessToken, pub.id, {
      type: 'REQUEST',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PUBLICATION_RESOLVED');

    const reopen = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: null });
    expect(reopen.body.data.resolution).toBeNull();
    expect(
      (await createPublicationInteraction(app, viewer.accessToken, pub.id, { type: 'REQUEST' }))
        .status,
    ).toBe(201);
    expect(events.map((e) => e.name)).toContain('animal.publication.resolved');
  });

  it('a MATING listing can be marked MATED; MATED is refused for other kinds', async () => {
    const { owner, pub } = await approvedListing('MATING');
    const mated = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: 'MATED' });
    expect(mated.status).toBe(200);
    expect(mated.body.data.resolution).toBe('MATED');

    const lost = await approvedListing('LOST');
    const bad = await request(app)
      .post(`${API}/animal-publications/${lost.pub.id}/resolution`)
      .set(bearer(lost.owner.accessToken))
      .send({ resolution: 'MATED' });
    expect(bad.status).toBe(400);
  });

  it('only the owner can resolve; outcomes must fit the kind; the moderation status is untouched', async () => {
    const { admin, owner, pub } = await approvedListing('MATING');
    const other = await registerUser(app);

    const byOther = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(other.accessToken))
      .send({ resolution: 'CLOSED' });
    expect(byOther.status).toBe(404);

    const wrongKind = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: 'ADOPTED' });
    expect(wrongKind.status).toBe(400);

    const closed = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: 'CLOSED' });
    expect(closed.status).toBe(200);
    const mod = await request(app)
      .get(`${API}/admin/animal-publications/${pub.id}`)
      .set(bearer(admin.accessToken));
    expect(mod.body.data).toMatchObject({ status: 'APPROVED', resolution: 'CLOSED' });
  });

  it('a PENDING listing has no outcome yet', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });
    const res = await request(app)
      .post(`${API}/animal-publications/${pub.id}/resolution`)
      .set(bearer(owner.accessToken))
      .send({ resolution: 'FOUND' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PUBLICATION_NOT_APPROVED');
  });
});
