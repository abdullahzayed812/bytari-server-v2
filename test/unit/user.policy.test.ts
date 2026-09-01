import { describe, expect, it } from 'vitest';
import { MAX_AVATAR_BYTES, UserPolicy } from '../../src/modules/users/user.policy.js';
import type { AppError } from '../../src/shared/errors/app-error.js';

describe('UserPolicy.assertAvatarUploadRequest', () => {
  it('accepts an allowed image MIME within the size limit', () => {
    expect(() =>
      UserPolicy.assertAvatarUploadRequest('image/png', 1024),
    ).not.toThrow();
  });

  it('accepts exactly the 5 MiB boundary', () => {
    expect(() =>
      UserPolicy.assertAvatarUploadRequest('image/jpeg', MAX_AVATAR_BYTES),
    ).not.toThrow();
  });

  it('rejects 5 MiB + 1 byte (FILE_TOO_LARGE)', () => {
    try {
      UserPolicy.assertAvatarUploadRequest('image/jpeg', MAX_AVATAR_BYTES + 1);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe('FILE_TOO_LARGE');
    }
  });

  it('rejects a disallowed MIME (UNSUPPORTED_FILE_TYPE)', () => {
    try {
      UserPolicy.assertAvatarUploadRequest('application/pdf', 1024);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('UNSUPPORTED_FILE_TYPE');
    }
  });

  it('rejects a non-positive size', () => {
    expect(() => UserPolicy.assertAvatarUploadRequest('image/png', 0)).toThrow();
  });
});

describe('UserPolicy.assertRegisteredAvatar', () => {
  it('re-validates the REAL mime/size the same way', () => {
    expect(() => UserPolicy.assertRegisteredAvatar('image/webp', 1024)).not.toThrow();
    expect(() => UserPolicy.assertRegisteredAvatar('image/webp', MAX_AVATAR_BYTES)).not.toThrow();
    expect(() => UserPolicy.assertRegisteredAvatar('image/webp', MAX_AVATAR_BYTES + 1)).toThrow();
    expect(() => UserPolicy.assertRegisteredAvatar('text/plain', 10)).toThrow();
  });
});

describe('UserPolicy.assertKeyBelongsToPrefix', () => {
  it('accepts a key under the expected prefix', () => {
    expect(() =>
      UserPolicy.assertKeyBelongsToPrefix('users/avatars/2026/08/abc.png', 'users/avatars'),
    ).not.toThrow();
  });

  it('rejects a key outside the prefix (STORAGE_KEY_MISMATCH)', () => {
    try {
      UserPolicy.assertKeyBelongsToPrefix('content/books/x.pdf', 'users/avatars');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('STORAGE_KEY_MISMATCH');
    }
  });

  it('rejects a prefix-substring trick', () => {
    expect(() =>
      UserPolicy.assertKeyBelongsToPrefix('users/avatars-evil/x.png', 'users/avatars'),
    ).toThrow();
  });
});
