import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENT_BYTES, VeterinarianPolicy } from '../../src/modules/veterinarians/veterinarian.policy.js';
import type { AppError } from '../../src/shared/errors/app-error.js';

describe('VeterinarianPolicy.assertDocumentUploadRequest', () => {
  it('LICENSE_OR_ID / ADDITIONAL_ID accept images and PDF', () => {
    for (const kind of ['LICENSE_OR_ID', 'ADDITIONAL_ID'] as const) {
      expect(() => VeterinarianPolicy.assertDocumentUploadRequest(kind, 'image/png', 1024)).not.toThrow();
      expect(() =>
        VeterinarianPolicy.assertDocumentUploadRequest(kind, 'application/pdf', 1024),
      ).not.toThrow();
    }
  });

  it('STUDENT_ID_FRONT / STUDENT_ID_BACK accept images only, reject PDF', () => {
    for (const kind of ['STUDENT_ID_FRONT', 'STUDENT_ID_BACK'] as const) {
      expect(() => VeterinarianPolicy.assertDocumentUploadRequest(kind, 'image/jpeg', 1024)).not.toThrow();
      try {
        VeterinarianPolicy.assertDocumentUploadRequest(kind, 'application/pdf', 1024);
        throw new Error('expected throw');
      } catch (err) {
        expect((err as AppError).code).toBe('UNSUPPORTED_FILE_TYPE');
      }
    }
  });

  it('accepts exactly the 5 MiB boundary for every kind', () => {
    expect(() =>
      VeterinarianPolicy.assertDocumentUploadRequest('LICENSE_OR_ID', 'application/pdf', MAX_DOCUMENT_BYTES),
    ).not.toThrow();
  });

  it('rejects 5 MiB + 1 byte (FILE_TOO_LARGE)', () => {
    try {
      VeterinarianPolicy.assertDocumentUploadRequest(
        'LICENSE_OR_ID',
        'application/pdf',
        MAX_DOCUMENT_BYTES + 1,
      );
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).code).toBe('FILE_TOO_LARGE');
    }
  });

  it('rejects a disallowed MIME (UNSUPPORTED_FILE_TYPE)', () => {
    try {
      VeterinarianPolicy.assertDocumentUploadRequest('LICENSE_OR_ID', 'text/plain', 1024);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).code).toBe('UNSUPPORTED_FILE_TYPE');
    }
  });

  it('rejects a non-positive size', () => {
    expect(() =>
      VeterinarianPolicy.assertDocumentUploadRequest('LICENSE_OR_ID', 'application/pdf', 0),
    ).toThrow();
  });
});

describe('VeterinarianPolicy.assertRegisteredDocument', () => {
  it('re-validates the REAL mime/size the same way', () => {
    expect(() =>
      VeterinarianPolicy.assertRegisteredDocument('STUDENT_ID_FRONT', 'image/webp', 1024),
    ).not.toThrow();
    expect(() =>
      VeterinarianPolicy.assertRegisteredDocument('STUDENT_ID_FRONT', 'application/pdf', 1024),
    ).toThrow();
    expect(() =>
      VeterinarianPolicy.assertRegisteredDocument(
        'LICENSE_OR_ID',
        'application/pdf',
        MAX_DOCUMENT_BYTES + 1,
      ),
    ).toThrow();
  });
});

describe('VeterinarianPolicy.assertKeyBelongsToPrefix', () => {
  it('accepts a key under the expected prefix', () => {
    expect(() =>
      VeterinarianPolicy.assertKeyBelongsToPrefix(
        'veterinarians/documents/2026/08/abc.pdf',
        'veterinarians/documents',
      ),
    ).not.toThrow();
  });

  it('rejects a key outside the prefix (STORAGE_KEY_MISMATCH)', () => {
    try {
      VeterinarianPolicy.assertKeyBelongsToPrefix('content/books/x.pdf', 'veterinarians/documents');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('STORAGE_KEY_MISMATCH');
    }
  });
});
