import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import type { AiResponderPort } from '../../src/modules/consultations/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createConsultation,
  createInquiry,
  listNotifications,
  listThreadMessages,
  registerAdmin,
  registerApprovedVet,
  registerSupportSupervisor,
  registerUser,
  sendThreadMessage,
  setAiSettings,
} from '../helpers/factories.js';

/** Records what the domain hands to the AI provider. */
class RecordingAiResponder implements AiResponderPort {
  mode: 'reply' | 'throw' = 'reply';
  inputs: Array<Parameters<AiResponderPort['generate']>[0]> = [];
  generate(input: Parameters<AiResponderPort['generate']>[0]): Promise<string | null> {
    this.inputs.push(input);
    if (this.mode === 'throw') return Promise.reject(new Error('provider down'));
    return Promise.resolve('إرشاد عام من المساعد.');
  }
}

const ai = new RecordingAiResponder();
const { app, container } = buildTestApp({ aiResponder: ai });
const events: DomainEvent[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('consultation.') || e.name.startsWith('inquiry.')) events.push(e);
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  await getTestDb()('ai_settings').update({ enabled: false, instruction: null });
  ai.mode = 'reply';
  ai.inputs = [];
  events.length = 0;
});
afterAll(() => closeTestDb());

describe('AI consultations / inquiries — admin instruction + single response', () => {
  it('the admin sets a fixed instruction per kind; it is sent to the AI with the message', async () => {
    const admin = await registerAdmin(app);
    const set = await setAiSettings(app, admin.accessToken, {
      consultationAiEnabled: true,
      consultationAiInstruction: '  أجب بإيجاز واذكر دائماً مراجعة طبيب بيطري.  ',
    });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({
      consultationAiEnabled: true,
      consultationAiInstruction: 'أجب بإيجاز واذكر دائماً مراجعة طبيب بيطري.',
      inquiryAiInstruction: null,
    });

    const owner = await registerUser(app);
    await createConsultation(app, owner.accessToken, 'my cat sneezes');
    expect(ai.inputs).toHaveLength(1);
    expect(ai.inputs[0]).toMatchObject({
      kind: 'CONSULTATION',
      instruction: 'أجب بإيجاز واذكر دائماً مراجعة طبيب بيطري.',
    });

    // clearing it (empty string) stores NULL
    const cleared = await setAiSettings(app, admin.accessToken, { consultationAiInstruction: '' });
    expect(cleared.body.data.consultationAiInstruction).toBeNull();
  });

  it('only an admin can read / change the AI settings (a supervisor cannot)', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    await request(app)
      .patch('/api/v1/admin/ai-settings')
      .set(bearer(sup.accessToken))
      .send({ consultationAiInstruction: 'x' })
      .expect(403);
    await request(app).get('/api/v1/admin/ai-settings').set(bearer(sup.accessToken)).expect(403);
  });

  it('one AI answer, then the thread is CLOSED and persisted; no second AI turn; one notification', async () => {
    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { inquiryAiEnabled: true });
    const vet = await registerApprovedVet(app);

    const created = await createInquiry(app, vet.accessToken, 'dose question');
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ status: 'CLOSED', aiResponded: true });

    const msgs = await listThreadMessages(app, vet.accessToken, 'inquiries', id);
    expect(msgs.body.data.map((m: { source: string }) => m.source)).toEqual(['USER', 'AI']);

    const followUp = await sendThreadMessage(app, vet.accessToken, 'inquiries', id, 'and?');
    expect(followUp.status).toBe(409);
    expect(ai.inputs).toHaveLength(1);

    await tick();
    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['inquiry.message.created', 'inquiry.closed']),
    );
    // The creator is told about the AI answer — not additionally about the auto-close.
    const notes = await listNotifications(app, vet.accessToken);
    const types = (notes.body.data as Array<{ type: string }>).map((n) => n.type);
    expect(types).toContain('INQUIRY_MESSAGE_RECEIVED');
    expect(types).not.toContain('INQUIRY_CLOSED');

    // audit trail of the automatic close
    const audit = await getTestDb()('audit_logs')
      .where({ entity_id: id, action: 'INQUIRY_CLOSED' })
      .first();
    expect(audit?.metadata).toMatchObject({ reason: 'AI_SINGLE_RESPONSE' });
  });

  it('an AI failure never marks the thread answered/closed — it stays OPEN for humans', async () => {
    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { consultationAiEnabled: true });
    ai.mode = 'throw';
    const owner = await registerUser(app);

    const c = await createConsultation(app, owner.accessToken, 'help');
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ status: 'OPEN', aiResponded: false });

    const reply = await sendThreadMessage(
      app,
      admin.accessToken,
      'consultations',
      c.body.data.id as string,
      'a human answer',
    );
    expect(reply.status).toBe(201);
  });
});
