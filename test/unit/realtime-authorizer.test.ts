import { describe, expect, it } from 'vitest';
import {
  CompositeRealtimeAuthorizer,
  SelfRoomAuthorizer,
  rooms,
  parseRoom,
  type RealtimeAuthorizer,
  type RealtimePrincipal,
} from '../../src/infra/realtime/index.js';

const principal = (userId: string | null): RealtimePrincipal => ({
  userId,
  roles: [],
  isAnonymous: userId === null,
});

describe('room helpers', () => {
  it('builds and parses namespaced rooms', () => {
    expect(rooms.conversation('c1')).toBe('conversation:c1');
    expect(parseRoom('org:o1')).toEqual({ kind: 'org', id: 'o1' });
    expect(parseRoom('nonsense')).toBeNull();
    expect(parseRoom(':x')).toBeNull();
  });
});

describe('SelfRoomAuthorizer', () => {
  const authz = new SelfRoomAuthorizer();

  it('allows a socket into its own user room only', async () => {
    expect(await authz.canSubscribe(principal('u1'), rooms.user('u1'))).toBe(true);
    expect(await authz.canSubscribe(principal('u1'), rooms.user('u2'))).toBe(false);
    expect(await authz.canSubscribe(principal('u1'), rooms.org('o1'))).toBe(false);
    expect(await authz.canSubscribe(principal(null), rooms.user('u1'))).toBe(false);
  });
});

describe('CompositeRealtimeAuthorizer', () => {
  it('delegates by room kind and falls back for unmatched kinds', async () => {
    const allowOrg: RealtimeAuthorizer = { canSubscribe: () => Promise.resolve(true) };
    const composite = new CompositeRealtimeAuthorizer().register('org', allowOrg);

    expect(await composite.canSubscribe(principal('u1'), rooms.org('o1'))).toBe(true);
    // conversation has no registered rule -> fallback (self-room) denies
    expect(await composite.canSubscribe(principal('u1'), rooms.conversation('c1'))).toBe(false);
    // fallback still allows own user room
    expect(await composite.canSubscribe(principal('u1'), rooms.user('u1'))).toBe(true);
  });
});
