import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { PublicationPolicy } from '../../src/modules/animals/domain/publication.policy.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';

const silent = pino({ level: 'silent' });

describe('PublicationPolicy', () => {
  it('assertIsCurrentOwner allows the current owner, rejects anyone else', () => {
    expect(() =>
      PublicationPolicy.assertIsCurrentOwner({ currentOwnerUserId: 'u1' }, 'u1'),
    ).not.toThrow();
    for (const owner of ['u2', null]) {
      try {
        PublicationPolicy.assertIsCurrentOwner({ currentOwnerUserId: owner }, 'u1');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(403);
      }
    }
  });

  it('assertAnimalActive rejects a DEACTIVATED animal with 409 ANIMAL_NOT_ACTIVE', () => {
    expect(() => PublicationPolicy.assertAnimalActive({ status: 'ACTIVE' })).not.toThrow();
    try {
      PublicationPolicy.assertAnimalActive({ status: 'DEACTIVATED' });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('ANIMAL_NOT_ACTIVE');
    }
  });

  it('assertPending rejects a non-PENDING publication with 409 PUBLICATION_NOT_PENDING', () => {
    expect(() => PublicationPolicy.assertPending({ status: 'PENDING' })).not.toThrow();
    for (const status of ['APPROVED', 'REJECTED'] as const) {
      try {
        PublicationPolicy.assertPending({ status });
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('PUBLICATION_NOT_PENDING');
      }
    }
  });
});

describe('AuthorizationService — system-supervisor domain fallback', () => {
  function build(domains: string[]) {
    const roles = { getPermissionKeysForUser: vi.fn().mockResolvedValue([]) };
    const permissions = { listKeys: vi.fn().mockResolvedValue([]) };
    const supervisors = { getActiveDomainsForUser: vi.fn().mockResolvedValue(domains) };
    return new AuthorizationService(
      roles as never,
      permissions as never,
      silent,
      undefined,
      supervisors as never,
    );
  }
  const principal = {
    userId: 'u1',
    roleKeys: ['PET_OWNER'],
    email: 'x',
    veterinarianStatus: 'NONE',
  };

  it('grants animal.approve / animal.reject to a user actively supervising ANIMAL', async () => {
    const svc = build(['ANIMAL']);
    expect(await svc.can(principal as never, 'animal.approve')).toBe(true);
    expect(await svc.can(principal as never, 'animal.reject')).toBe(true);
    expect(await svc.can(principal as never, 'animal.read')).toBe(true);
  });

  it('does NOT grant animal.approve to a supervisor of a different domain', async () => {
    const svc = build(['CLINIC']);
    expect(await svc.can(principal as never, 'animal.approve')).toBe(false);
  });

  it('does NOT grant animal.approve to a user with no supervisor assignment', async () => {
    const svc = build([]);
    expect(await svc.can(principal as never, 'animal.approve')).toBe(false);
  });

  it('does not grant unrelated permissions via the ANIMAL domain', async () => {
    const svc = build(['ANIMAL']);
    expect(await svc.can(principal as never, 'organization.admin.approve')).toBe(false);
  });
});
