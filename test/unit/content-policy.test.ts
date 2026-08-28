import { describe, expect, it } from 'vitest';
import { ContentPolicy } from '../../src/modules/content/domain/content.policy.js';
import type { AppError } from '../../src/shared/errors/app-error.js';

describe('ContentPolicy lifecycle no-op detection', () => {
  it('publish changes DRAFT / ARCHIVED, no-ops PUBLISHED', () => {
    expect(ContentPolicy.assertCanPublish('DRAFT')).toBe(true);
    expect(ContentPolicy.assertCanPublish('ARCHIVED')).toBe(true);
    expect(ContentPolicy.assertCanPublish('PUBLISHED')).toBe(false);
  });
  it('archive changes DRAFT / PUBLISHED, no-ops ARCHIVED', () => {
    expect(ContentPolicy.assertCanArchive('DRAFT')).toBe(true);
    expect(ContentPolicy.assertCanArchive('PUBLISHED')).toBe(true);
    expect(ContentPolicy.assertCanArchive('ARCHIVED')).toBe(false);
  });
});

describe('ContentPolicy.assertFileUploadRequest', () => {
  it('accepts a PDF MAIN file within the size limit', () => {
    expect(() =>
      ContentPolicy.assertFileUploadRequest('MAIN', 'application/pdf', 1024),
    ).not.toThrow();
  });
  it('rejects a disallowed MIME for the kind (UNSUPPORTED_FILE_TYPE)', () => {
    try {
      ContentPolicy.assertFileUploadRequest('MAIN', 'text/plain', 1024);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('UNSUPPORTED_FILE_TYPE');
    }
  });
  it('rejects an oversized declared size (FILE_TOO_LARGE)', () => {
    try {
      ContentPolicy.assertFileUploadRequest('MAIN', 'application/pdf', 200 * 1024 * 1024);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe('FILE_TOO_LARGE');
    }
  });
  it('rejects a non-positive size', () => {
    expect(() => ContentPolicy.assertFileUploadRequest('MAIN', 'application/pdf', 0)).toThrow();
  });
});

describe('ContentPolicy.assertKeyBelongsToPrefix', () => {
  it('accepts a key under the expected prefix', () => {
    expect(() =>
      ContentPolicy.assertKeyBelongsToPrefix('content/books/2026/08/abc.pdf', 'content/books'),
    ).not.toThrow();
  });
  it('rejects a key outside the prefix (STORAGE_KEY_MISMATCH)', () => {
    try {
      ContentPolicy.assertKeyBelongsToPrefix('content/articles/x.pdf', 'content/books');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('STORAGE_KEY_MISMATCH');
    }
  });
  it('rejects a prefix-substring trick (content/books-evil/…)', () => {
    expect(() =>
      ContentPolicy.assertKeyBelongsToPrefix('content/books-evil/x.pdf', 'content/books'),
    ).toThrow();
  });
});
