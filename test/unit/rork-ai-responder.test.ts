import { afterEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { RorkAiResponder } from '../../src/modules/consultations/infrastructure/rork-ai-responder.js';
import type { MessageSource } from '../../src/modules/consultations/domain/thread.constants.js';

const logger = pino({ level: 'silent' });
const URL = 'https://toolkit.example/text/llm/';

function make(): RorkAiResponder {
  return new RorkAiResponder({ url: URL, timeoutMs: 5_000 }, logger);
}

function msg(source: MessageSource, body: string): { source: MessageSource; body: string } {
  return { source, body };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RorkAiResponder', () => {
  it('POSTs {messages} with a system prompt + mapped roles and returns the trimmed completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ completion: '  hello there  ' }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await make().generate({
      kind: 'CONSULTATION',
      threadId: 't1',
      messages: [
        msg('USER', 'my cat is sick'),
        msg('AI', 'earlier ai note'),
        msg('SUPERVISOR', 'a vet replied'),
        msg('SYSTEM', 'system note'),
      ],
    });

    expect(out).toBe('hello there');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>)['content-type']).toBe('application/json');
    const payload = JSON.parse(opts.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.messages[0]?.role).toBe('system');
    expect(payload.messages.slice(1).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'assistant',
      'system',
    ]);
    expect(payload.messages.map((m) => m.content)).not.toContain('');
  });

  it('returns null for a blank / missing completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ completion: '   ' })));
    expect(
      await make().generate({ kind: 'INQUIRY', threadId: 't', messages: [msg('USER', 'q')] }),
    ).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})));
    expect(
      await make().generate({ kind: 'INQUIRY', threadId: 't', messages: [msg('USER', 'q')] }),
    ).toBeNull();
  });

  it('never calls the endpoint when there is no user message to answer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await make().generate({
      kind: 'CONSULTATION',
      threadId: 't',
      messages: [msg('SYSTEM', 'note'), msg('USER', '   ')],
    });
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx response (caller logs + swallows)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, { ok: false, status: 400 })),
    );
    await expect(
      make().generate({ kind: 'CONSULTATION', threadId: 't', messages: [msg('USER', 'q')] }),
    ).rejects.toThrow(/400/);
  });

  it('propagates a network / timeout rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation timed out')));
    await expect(
      make().generate({ kind: 'CONSULTATION', threadId: 't', messages: [msg('USER', 'q')] }),
    ).rejects.toThrow(/timed out/);
  });
});
