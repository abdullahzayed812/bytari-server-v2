import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { SignJWT } from 'jose';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import type { AuthConfig } from '../../src/config/index.js';

const silent = pino({ level: 'silent' });

function cfg(overrides: Partial<AuthConfig['jwt']> = {}): AuthConfig {
  return {
    jwt: {
      accessSecret: 'unit-test-secret-key-at-least-32-characters-long',
      accessTtl: '15m',
      refreshTtl: '30d',
      issuer: 'bytari',
      audience: 'bytari-app',
      ...overrides,
    },
  } as unknown as AuthConfig;
}

describe('TokenService', () => {
  it('signs and verifies an access token round-trip', async () => {
    const svc = new TokenService(cfg(), silent);
    const { token, expiresIn } = await svc.signAccessToken('user-1', 'session-9');
    expect(expiresIn).toBe(900);
    const verified = await svc.verifyAccessToken(token);
    expect(verified).toEqual({ userId: 'user-1', sessionId: 'session-9' });
  });

  it('rejects a token signed with a different secret', async () => {
    const svc = new TokenService(cfg(), silent);
    const forged = await new SignJWT({ sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('bytari')
      .setAudience('bytari-app')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('a-totally-different-secret-value-here-too'));
    await expect(svc.verifyAccessToken(forged)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an expired token', async () => {
    const svc = new TokenService(cfg(), silent);
    const expired = await new SignJWT({ sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('bytari')
      .setAudience('bytari-app')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(new TextEncoder().encode('unit-test-secret-key-at-least-32-characters-long'));
    await expect(svc.verifyAccessToken(expired)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a token with the wrong issuer/audience', async () => {
    const svc = new TokenService(cfg(), silent);
    const wrongAud = await new SignJWT({ sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuer('bytari')
      .setAudience('someone-else')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('unit-test-secret-key-at-least-32-characters-long'));
    await expect(svc.verifyAccessToken(wrongAud)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects garbage input', async () => {
    const svc = new TokenService(cfg(), silent);
    await expect(svc.verifyAccessToken('not.a.jwt')).rejects.toBeInstanceOf(AppError);
  });

  it('falls back to an ephemeral secret when none is configured (dev)', async () => {
    const svc = new TokenService(cfg({ accessSecret: null }), silent);
    const { token } = await svc.signAccessToken('u', 's');
    await expect(svc.verifyAccessToken(token)).resolves.toMatchObject({ userId: 'u' });
  });
});
