import type { Logger } from 'pino';
import type { MessageSource, ThreadKind } from '../domain/thread.constants.js';
import type { AiResponderPort } from '../application/ai-responder.port.js';

/**
 * {@link AiResponderPort} backed by the Rork text-LLM toolkit.
 *
 *   POST <url>
 *   Content-Type: application/json          (no auth — public proxy)
 *   { "messages": [ { "role": "system" | "user" | "assistant", "content": string } ] }
 *   → 200 { "completion": string }
 *   → 400 { "error": "Invalid request body" }
 *   → 5xx { "error": "Internal server error" }
 *
 * Contract obligations inherited from the port:
 *  - called AFTER the thread transaction commits;
 *  - returns the reply text, or `null` to post no AI message;
 *  - MAY throw — the caller logs and swallows, leaving the thread intact;
 *  - never receives or returns credentials (there are none for this endpoint).
 *
 * The endpoint URL is the only configuration ({@link RorkAiResponderOptions});
 * it stays on the backend and is never shipped to the mobile client.
 */
export interface RorkAiResponderOptions {
  url: string;
  timeoutMs: number;
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Short, safety-scoped priming per kind. Kept generic — no user data here. */
const SYSTEM_PROMPT: Record<ThreadKind, string> = {
  CONSULTATION:
    'أنت مساعد بيطري ضمن تطبيق "بيطري". يقرأ صاحب حيوان أليف ردّك مباشرة. ' +
    'قدّم إرشادات عامة أولية باللغة العربية، وكن موجزًا وواضحًا. ' +
    'لا تقدّم تشخيصًا نهائيًا ولا وصفة دوائية محدّدة، وانصح بمراجعة طبيب بيطري ' +
    'أو عيادة عند وجود أعراض خطيرة أو طارئة. لا يمكنك حجز المواعيد أو إغلاق ' +
    'الطلب أو تغيير حالته أو إحالته — أنت تكتب رسالة إرشادية فقط.',
  INQUIRY:
    'أنت مساعد بيطري ضمن تطبيق "بيطري". يقرأ طبيب بيطري معتمد استفساره العام هنا. ' +
    'قدّم إجابة مهنية موجزة باللغة العربية مع الإشارة إلى المصادر أو الإرشادات ' +
    'العامة عند الإمكان. لا يمكنك تغيير حالة الطلب أو إغلاقه أو إحالته — أنت ' +
    'تكتب رسالة فقط.',
  SUPPORT:
    'أنت مساعد دعم فني لتطبيق "بيطري". أجب باقتضاب وباللغة العربية. ' +
    'لا يمكنك تغيير حالة الطلب أو إغلاقه.',
};

/** Thread message `source` → LLM role. */
function toRole(source: MessageSource): LlmMessage['role'] {
  if (source === 'USER') return 'user';
  if (source === 'SYSTEM') return 'system';
  // SUPERVISOR / ADMIN / AI — everything the creator did NOT write is context
  // the assistant should treat as its own / the responder's side.
  return 'assistant';
}

export class RorkAiResponder implements AiResponderPort {
  private readonly log: Logger;

  constructor(
    private readonly opts: RorkAiResponderOptions,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'rork-ai-responder' });
  }

  async generate(input: {
    kind: ThreadKind;
    threadId: string;
    messages: Array<{ source: MessageSource; body: string }>;
  }): Promise<string | null> {
    const history: LlmMessage[] = input.messages
      .map((m) => ({ role: toRole(m.source), content: m.body.trim() }))
      .filter((m) => m.content.length > 0);

    // Nothing to respond to — skip the call (the endpoint 500s on an empty set).
    if (!history.some((m) => m.role === 'user')) return null;

    const payload: { messages: LlmMessage[] } = {
      messages: [{ role: 'system', content: SYSTEM_PROMPT[input.kind] }, ...history],
    };

    const res = await fetch(this.opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`rork ai responder responded ${res.status}`);
    }

    const json = (await res.json()) as { completion?: unknown };
    const text = typeof json.completion === 'string' ? json.completion.trim() : '';
    if (text.length === 0) {
      this.log.warn({ threadId: input.threadId }, 'rork ai responder returned an empty completion');
      return null;
    }
    return text;
  }
}
