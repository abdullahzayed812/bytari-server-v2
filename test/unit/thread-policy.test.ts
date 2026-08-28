import { describe, expect, it } from 'vitest';
import { ThreadPolicy } from '../../src/modules/consultations/domain/thread.policy.js';
import type { SupportThread } from '../../src/modules/consultations/domain/thread.types.js';
import type { AppError } from '../../src/shared/errors/app-error.js';

function thread(over: Partial<SupportThread> = {}): SupportThread {
  return {
    id: 't1',
    createdByUserId: 'u1',
    animalId: null,
    status: 'OPEN',
    senderBlockedAt: null,
    aiResponded: false,
    lastMessageAt: null,
    closedAt: null,
    closedByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('ThreadPolicy.assertCreatorMayPost', () => {
  it('allows an OPEN, unblocked thread', () => {
    expect(() => ThreadPolicy.assertCreatorMayPost(thread())).not.toThrow();
  });

  it('rejects a CLOSED thread with 409 THREAD_NOT_WRITABLE', () => {
    try {
      ThreadPolicy.assertCreatorMayPost(thread({ status: 'CLOSED' }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('THREAD_NOT_WRITABLE');
    }
  });

  it('rejects a sender-blocked thread with 403 THREAD_NOT_WRITABLE', () => {
    try {
      ThreadPolicy.assertCreatorMayPost(thread({ senderBlockedAt: '2026-01-02T00:00:00.000Z' }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).code).toBe('THREAD_NOT_WRITABLE');
    }
  });
});

describe('ThreadPolicy.assertResponderMayPost', () => {
  it('allows OPEN (even when the sender is blocked — block only mutes the creator)', () => {
    expect(() =>
      ThreadPolicy.assertResponderMayPost(thread({ senderBlockedAt: '2026-01-02T00:00:00.000Z' })),
    ).not.toThrow();
  });

  it('rejects CLOSED with 409', () => {
    try {
      ThreadPolicy.assertResponderMayPost(thread({ status: 'CLOSED' }));
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('THREAD_NOT_WRITABLE');
    }
  });
});
