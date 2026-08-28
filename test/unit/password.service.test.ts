import { describe, expect, it } from 'vitest';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import type { AuthConfig } from '../../src/config/index.js';

const authConfig = {
  argon2: { memoryCost: 512, timeCost: 1, parallelism: 1 },
} as unknown as AuthConfig;

const svc = new PasswordService(authConfig);

describe('PasswordService', () => {
  it('produces an Argon2id PHC string, not the plaintext', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('salts: hashing the same password twice yields different hashes', async () => {
    const [a, b] = await Promise.all([svc.hash('same-password'), svc.hash('same-password')]);
    expect(a).not.toBe(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await svc.hash('s3cret-passphrase');
    expect(await svc.verify(hash, 's3cret-passphrase')).toBe(true);
    expect(await svc.verify(hash, 's3cret-passphras3')).toBe(false);
  });

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await svc.verify('not-a-real-hash', 'whatever')).toBe(false);
  });
});
