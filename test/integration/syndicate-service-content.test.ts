import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  assignOrganizationSupervisor,
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

interface Content {
  heading: string | null;
  body: string | null;
  sections: { id: string; title: string; style: string; items: { id: string; text: string }[] }[];
  footnote: string | null;
  note: string | null;
}
interface ServiceItem {
  id: string;
  serviceKey: string;
  title: string | null;
  description: string | null;
  content: Content | null;
}

async function setup() {
  const admin = await registerAdmin(app);
  const syndicate = await createSyndicate(app, admin.accessToken, { name: 'نقابة البيطريين' });
  const manager = await registerUser(app);
  const res = await request(app)
    .post(api(`/${syndicate.id}/admins`))
    .set(bearer(admin.accessToken))
    .send({ email: manager.email });
  expect(res.status).toBe(201);
  return { admin, manager, syndicateId: syndicate.id };
}

async function services(token: string, syndicateId: string): Promise<ServiceItem[]> {
  const res = await request(app)
    .get(api(`/${syndicateId}/services`))
    .set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data as ServiceItem[];
}

const byKey = (items: ServiceItem[], key: string): ServiceItem =>
  items.find((i) => i.serviceKey === key) as ServiceItem;

const patch = (token: string, syndicateId: string, serviceId: string, body: object) =>
  request(app)
    .patch(api(`/${syndicateId}/services/${serviceId}`))
    .set(bearer(token))
    .send(body);

const CONTENT = {
  heading: 'المتطلبات',
  body: null,
  sections: [
    {
      title: 'لإصدار هوية نقابية جديدة',
      style: 'CHECK',
      items: [{ text: 'صورة شخصية حديثة بخلفية بيضاء.' }, { text: 'سداد الرسوم المقررة.' }],
    },
    { title: 'ملاحظات مهمة', style: 'NOTE', items: [{ text: 'يجب أن تكون العضوية سارية.' }] },
  ],
  footnote: 'مدة المعالجة: من 3 إلى 5 أيام عمل.',
  note: 'يمكنك متابعة الطلب من خلال حسابك.',
};

describe('syndicate service page content (sections + items)', () => {
  it('starts null (built-in content) and a manager saves ordered sections/items in place', async () => {
    const { manager, syndicateId } = await setup();
    const before = await services(manager.accessToken, syndicateId);
    expect(before.every((s) => s.content === null)).toBe(true);
    const idCard = byKey(before, 'ID_CARD');

    const saved = await patch(manager.accessToken, syndicateId, idCard.id, { content: CONTENT });
    expect(saved.status).toBe(200);
    expect(saved.body.data.id).toBe(idCard.id);
    const content = saved.body.data.content as Content;
    expect(content.sections.map((s) => s.title)).toEqual([
      'لإصدار هوية نقابية جديدة',
      'ملاحظات مهمة',
    ]);
    expect(content.sections[0]!.items.map((i) => i.text)).toEqual([
      'صورة شخصية حديثة بخلفية بيضاء.',
      'سداد الرسوم المقررة.',
    ]);
    expect(content.sections[1]!.style).toBe('NOTE');
    // Every section / item got a stable id.
    const ids = content.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(5);

    // Edit: rename an item, delete one, add one, reorder sections — ids kept, nothing duplicated.
    const [first, second] = content.sections as [Content['sections'][0], Content['sections'][0]];
    const edited = {
      ...content,
      sections: [
        second,
        {
          ...first,
          items: [
            { id: first.items[0]!.id, text: 'صورة شخصية ملونة.' },
            { text: 'صورة من البطاقة الوطنية.' },
          ],
        },
      ],
    };
    const res = await patch(manager.accessToken, syndicateId, idCard.id, { content: edited });
    expect(res.status).toBe(200);
    const after = res.body.data.content as Content;
    expect(after.sections.map((s) => s.id)).toEqual([second.id, first.id]);
    expect(after.sections[1]!.items[0]).toEqual({
      id: first.items[0]!.id,
      text: 'صورة شخصية ملونة.',
    });
    expect(after.sections[1]!.items).toHaveLength(2);

    // Public read shows the saved content; title / description / other services untouched.
    const viewer = await registerUser(app);
    const visible = await services(viewer.accessToken, syndicateId);
    expect(visible).toHaveLength(6);
    expect(byKey(visible, 'ID_CARD').content).toEqual(after);
    expect(byKey(visible, 'ID_CARD').title).toBeNull();
    expect(byKey(visible, 'LEGAL_SUPPORT').content).toBeNull();
    const rows = await getTestDb()('syndicate_services').where({ organization_id: syndicateId });
    expect(rows).toHaveLength(6);
  });

  it('allows an empty section, and null resets the page to the built-in content', async () => {
    const { manager, syndicateId } = await setup();
    const legal = byKey(await services(manager.accessToken, syndicateId), 'LEGAL_SUPPORT');
    const empty = await patch(manager.accessToken, syndicateId, legal.id, {
      content: { heading: 'معلومات الخدمة', body: 'نص', sections: [{ title: 'قسم', items: [] }] },
    });
    expect(empty.status).toBe(200);
    expect(empty.body.data.content.sections[0]).toMatchObject({ style: 'CHECK', items: [] });
    expect(empty.body.data.content.footnote).toBeNull();

    const reset = await patch(manager.accessToken, syndicateId, legal.id, { content: null });
    expect(reset.status).toBe(200);
    expect(reset.body.data.content).toBeNull();
  });

  it('validates the document and rejects content on a service without a content page', async () => {
    const { manager, syndicateId } = await setup();
    const items = await services(manager.accessToken, syndicateId);
    const idCard = byKey(items, 'ID_CARD');

    const blankItem = await patch(manager.accessToken, syndicateId, idCard.id, {
      content: { sections: [{ title: 'قسم', items: [{ text: '   ' }] }] },
    });
    expect(blankItem.status).toBe(422);
    const blankTitle = await patch(manager.accessToken, syndicateId, idCard.id, {
      content: { sections: [{ title: '', items: [] }] },
    });
    expect(blankTitle.status).toBe(422);
    const unknownField = await patch(manager.accessToken, syndicateId, idCard.id, {
      content: { sections: [], html: '<b>x</b>' },
    });
    expect(unknownField.status).toBe(422);

    const inquiry = byKey(items, 'INQUIRY');
    const wrongService = await patch(manager.accessToken, syndicateId, inquiry.id, {
      content: { sections: [] },
    });
    expect(wrongService.status).toBe(422);
    expect(byKey(await services(manager.accessToken, syndicateId), 'ID_CARD').content).toBeNull();
  });

  it('ADMIN and authorized managers may edit; a supervisor without syndicate.profile.manage and a stranger may not', async () => {
    const { admin, syndicateId } = await setup();
    const idCard = byKey(await services(admin.accessToken, syndicateId), 'ID_CARD');

    const byAdmin = await patch(admin.accessToken, syndicateId, idCard.id, { content: CONTENT });
    expect(byAdmin.status).toBe(200);

    const officer = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, admin.accessToken, syndicateId, {
      userId: officer.id,
      permissions: ['syndicate.submission.read', 'syndicate.submission.respond'],
    });
    const byOfficer = await patch(officer.accessToken, syndicateId, idCard.id, {
      content: { sections: [] },
    });
    expect(byOfficer.status).toBe(403);

    const editor = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, admin.accessToken, syndicateId, {
      userId: editor.id,
      permissions: ['syndicate.profile.manage'],
    });
    const byEditor = await patch(editor.accessToken, syndicateId, idCard.id, {
      content: { ...CONTENT, heading: 'الشروط' },
    });
    expect(byEditor.status).toBe(200);
    expect(byEditor.body.data.content.heading).toBe('الشروط');

    const stranger = await registerUser(app);
    const byStranger = await patch(stranger.accessToken, syndicateId, idCard.id, {
      content: { sections: [] },
    });
    expect(byStranger.status).toBe(403);
    expect(
      byKey(await services(stranger.accessToken, syndicateId), 'ID_CARD').content?.heading,
    ).toBe('الشروط');
  });
});
