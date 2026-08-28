import type { MessageSource, ThreadKind } from '../domain/thread.constants.js';

/**
 * The seam between the Consultation/Inquiry domain and an AI provider.
 *
 * Phase 13 ships ONLY {@link NoopAiResponder} (always `null` → no AI message).
 * A real provider is Phase 14+: implement this interface, bind it in
 * `createContainer`, and nothing else in the domain changes.
 *
 * Contract:
 *  - Called AFTER the thread transaction has committed — never inside it.
 *  - Returns the assistant reply text, or `null` to post no AI message.
 *  - May reject; the caller catches, logs, and leaves the thread intact
 *    (an AI failure must not corrupt the consultation/inquiry).
 *  - Must never receive or return credentials.
 */
export interface AiResponderPort {
  generate(input: {
    kind: ThreadKind;
    threadId: string;
    messages: Array<{ source: MessageSource; body: string }>;
  }): Promise<string | null>;
}

/** Default binding: AI is never actually produced until a provider is added. */
export class NoopAiResponder implements AiResponderPort {
  generate(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
