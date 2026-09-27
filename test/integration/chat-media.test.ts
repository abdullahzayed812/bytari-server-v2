import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { buildRealtimeHarness, TestWs, type RealtimeHarness } from '../helpers/realtime.js';
import {
  ContentSniffingObjectStorage,
  InMemoryObjectStorage,
} from '../../src/infra/storage/index.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  startConversation,
} from '../helpers/factories.js';

// Production-shaped storage: declared Content-Types are verified against magic bytes.
const storage = new ContentSniffingObjectStorage(new InMemoryObjectStorage(null));
let harness: RealtimeHarness;

beforeAll(async () => {
  await ensureSchema();
  harness = await buildRealtimeHarness({ objectStorage: storage });
});
beforeEach(() => resetDb());
afterAll(async () => {
  await harness.close();
  await closeTestDb();
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom', 'latin1'),
  Buffer.alloc(4096, 2),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(1024, 3)]);

async function clinicConversation() {
  const app = harness.app;
  const admin = await registerAdmin(app);
  const vetOwner = await registerApprovedVet(app);
  const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: 'Media Clinic',
  });
  const petOwner = await registerUser(app);
  const outsider = await registerUser(app);
  const conv = await startConversation(app, petOwner.accessToken, clinic.id);
  return { app, admin, vetOwner, clinic, petOwner, outsider, conv };
}

/** presign → PUT bytes (simulated direct upload) → storage key. */
async function upload(
  token: string,
  conversationId: string,
  kind: 'IMAGE' | 'VIDEO' | 'FILE',
  file: { name: string; mimeType: string; bytes: Buffer },
): Promise<string> {
  const res = await request(harness.app)
    .post(`/api/v1/conversations/${conversationId}/attachments/upload-url`)
    .set(bearer(token))
    .send({ kind, filename: file.name, mimeType: file.mimeType, size: file.bytes.length });
  if (res.status !== 200)
    throw new Error(`presign failed ${res.status} ${JSON.stringify(res.body)}`);
  const key = res.body.data.storageKey as string;
  await storage.put(key, file.bytes, { contentType: file.mimeType });
  return key;
}

function send(token: string, conversationId: string, body: Record<string, unknown>) {
  return request(harness.app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(bearer(token))
    .send(body);
}

describe('chat media — send & receive', () => {
  it.each([
    ['IMAGE', { name: 'photo.jpg', mimeType: 'image/jpeg', bytes: JPEG }],
    ['VIDEO', { name: 'clip.mp4', mimeType: 'video/mp4', bytes: MP4 }],
    ['FILE', { name: 'report.pdf', mimeType: 'application/pdf', bytes: PDF }],
  ] as const)(
    '%s: stored privately, persisted, listed with a signed URL and no key',
    async (kind, file) => {
      const { vetOwner, petOwner, conv } = await clinicConversation();
      const key = await upload(petOwner.accessToken, conv.id, kind, file);
      expect(key.startsWith(`chat/attachments/${conv.id}/`)).toBe(true);

      const sent = await send(petOwner.accessToken, conv.id, {
        attachment: { kind, storageKey: key, fileName: file.name },
      });
      expect(sent.status).toBe(201);
      expect(sent.body.data.body).toBe('');
      expect(sent.body.data.attachment).toMatchObject({
        kind,
        fileName: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.length,
      });
      // no raw key field anywhere — the key only appears inside the signed URL
      const { url, ...rest } = sent.body.data.attachment as Record<string, unknown>;
      expect(url).toEqual(expect.any(String));
      expect(JSON.stringify({ ...sent.body.data, attachment: rest })).not.toContain(key);

      const row = await getTestDb()('messages').where({ id: sent.body.data.id }).first();
      expect(row).toMatchObject({ attachment_kind: kind, attachment_storage_key: key });

      // the clinic side (recipient) sees it with a usable URL
      const list = await request(harness.app)
        .get(`/api/v1/conversations/${conv.id}/messages`)
        .set(bearer(vetOwner.accessToken));
      const msg = list.body.data.find((m: { id: string }) => m.id === sent.body.data.id);
      expect(msg.attachment.url).toEqual(expect.any(String));
      expect(msg.attachment).not.toHaveProperty('storageKey');
    },
  );

  it('text + attachment together; empty message without attachment is refused', async () => {
    const { petOwner, conv } = await clinicConversation();
    const key = await upload(petOwner.accessToken, conv.id, 'IMAGE', {
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      bytes: JPEG,
    });
    const both = await send(petOwner.accessToken, conv.id, {
      body: 'see photo',
      attachment: { kind: 'IMAGE', storageKey: key, fileName: 'a.jpg' },
    });
    expect(both.status).toBe(201);
    expect(both.body.data.body).toBe('see photo');
    expect((await send(petOwner.accessToken, conv.id, {})).status).toBe(422);
    expect((await send(petOwner.accessToken, conv.id, { body: '   ' })).status).toBe(422);
  });

  it('delivers the realtime event to the recipient (ids only)', async () => {
    const { vetOwner, petOwner, conv } = await clinicConversation();
    const ws = await TestWs.connect(harness.wsUrl(vetOwner.accessToken));
    await ws.next('welcome');
    ws.send('subscribe', { room: `conversation:${conv.id}` });
    await ws.next('subscribed');

    const key = await upload(petOwner.accessToken, conv.id, 'FILE', {
      name: 'r.pdf',
      mimeType: 'application/pdf',
      bytes: PDF,
    });
    const sent = await send(petOwner.accessToken, conv.id, {
      attachment: { kind: 'FILE', storageKey: key, fileName: 'r.pdf' },
    });
    const evt = await ws.next('chat.message.created');
    expect(evt.data).toMatchObject({ conversationId: conv.id, messageId: sent.body.data.id });
    expect(JSON.stringify(evt.data)).not.toContain(key);
    ws.close();
  });
});

describe('chat media — validation & security', () => {
  it('refuses a disallowed MIME / oversize at presign', async () => {
    const { petOwner, conv } = await clinicConversation();
    const presign = (body: Record<string, unknown>) =>
      request(harness.app)
        .post(`/api/v1/conversations/${conv.id}/attachments/upload-url`)
        .set(bearer(petOwner.accessToken))
        .send(body);
    expect(
      (
        await presign({
          kind: 'IMAGE',
          filename: 'x.exe',
          mimeType: 'application/x-msdownload',
          size: 10,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await presign({
          kind: 'VIDEO',
          filename: 'big.mp4',
          mimeType: 'video/mp4',
          size: 60 * 1024 * 1024,
        })
      ).status,
    ).toBe(400);
  });

  it('a file whose bytes lie about its type is rejected at send', async () => {
    const { petOwner, conv } = await clinicConversation();
    const key = await upload(petOwner.accessToken, conv.id, 'IMAGE', {
      name: 'evil.jpg',
      mimeType: 'image/jpeg',
      bytes: Buffer.from('<html><script>alert(1)</script></html>'),
    });
    const res = await send(petOwner.accessToken, conv.id, {
      attachment: { kind: 'IMAGE', storageKey: key, fileName: 'evil.jpg' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('an outsider cannot presign, read messages or fetch an attachment (404)', async () => {
    const { petOwner, outsider, conv } = await clinicConversation();
    const key = await upload(petOwner.accessToken, conv.id, 'IMAGE', {
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      bytes: JPEG,
    });
    const sent = await send(petOwner.accessToken, conv.id, {
      attachment: { kind: 'IMAGE', storageKey: key, fileName: 'a.jpg' },
    });
    const presign = await request(harness.app)
      .post(`/api/v1/conversations/${conv.id}/attachments/upload-url`)
      .set(bearer(outsider.accessToken))
      .send({ kind: 'IMAGE', filename: 'a.jpg', mimeType: 'image/jpeg', size: 10 });
    expect(presign.status).toBe(404);
    const fetch = await request(harness.app)
      .get(`/api/v1/conversations/${conv.id}/messages/${sent.body.data.id}/attachment`)
      .set(bearer(outsider.accessToken));
    expect(fetch.status).toBe(404);
    const participant = await request(harness.app)
      .get(`/api/v1/conversations/${conv.id}/messages/${sent.body.data.id}/attachment`)
      .set(bearer(petOwner.accessToken));
    expect(participant.status).toBe(200);
    expect(participant.body.data.url).toEqual(expect.any(String));
  });

  it("a key from another conversation, a forged key, or an already-linked key can't be attached", async () => {
    const a = await clinicConversation();
    const other = await registerUser(harness.app);
    const convB = await startConversation(harness.app, other.accessToken, a.clinic.id);
    const keyB = await upload(other.accessToken, convB.id, 'IMAGE', {
      name: 'b.jpg',
      mimeType: 'image/jpeg',
      bytes: JPEG,
    });

    // cross-conversation key
    const cross = await send(a.petOwner.accessToken, a.conv.id, {
      attachment: { kind: 'IMAGE', storageKey: keyB, fileName: 'b.jpg' },
    });
    expect(cross.status).toBe(400);
    expect(cross.body.error.code).toBe('STORAGE_KEY_MISMATCH');

    // forged key inside the right prefix but never uploaded
    const forged = await send(a.petOwner.accessToken, a.conv.id, {
      attachment: {
        kind: 'IMAGE',
        storageKey: `chat/attachments/${a.conv.id}/2026/01/nope.jpg`,
        fileName: 'x.jpg',
      },
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('STORAGE_OBJECT_MISSING');

    // reuse of an already linked object
    const keyA = await upload(a.petOwner.accessToken, a.conv.id, 'IMAGE', {
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      bytes: JPEG,
    });
    const first = await send(a.petOwner.accessToken, a.conv.id, {
      attachment: { kind: 'IMAGE', storageKey: keyA, fileName: 'a.jpg' },
    });
    expect(first.status).toBe(201);
    const reuse = await send(a.petOwner.accessToken, a.conv.id, {
      attachment: { kind: 'IMAGE', storageKey: keyA, fileName: 'a.jpg' },
    });
    expect(reuse.status).toBe(409);
  });

  it('deleting the message hides the attachment and removes the object', async () => {
    const { petOwner, vetOwner, conv } = await clinicConversation();
    const key = await upload(petOwner.accessToken, conv.id, 'IMAGE', {
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      bytes: JPEG,
    });
    const sent = await send(petOwner.accessToken, conv.id, {
      attachment: { kind: 'IMAGE', storageKey: key, fileName: 'a.jpg' },
    });
    const del = await request(harness.app)
      .delete(`/api/v1/messages/${sent.body.data.id}`)
      .set(bearer(petOwner.accessToken));
    expect(del.status).toBe(200);
    expect(del.body.data.attachment).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    const fetch = await request(harness.app)
      .get(`/api/v1/conversations/${conv.id}/messages/${sent.body.data.id}/attachment`)
      .set(bearer(vetOwner.accessToken));
    expect(fetch.status).toBe(404);
  });
});
