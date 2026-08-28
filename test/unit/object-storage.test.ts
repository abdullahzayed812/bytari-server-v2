import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import {
  InMemoryObjectStorage,
  ObjectNotFoundError,
  buildObjectKey,
  sanitizeKey,
  StoragePrefix,
} from '../../src/infra/storage/index.js';
import { R2ObjectStorage } from '../../src/infra/storage/r2-object-storage.js';
import type * as S3Module from '@aws-sdk/client-s3';
import type { R2Config } from '../../src/config/index.js';

const silentLogger = pino({ level: 'silent' });

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockGetSignedUrl }));
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof S3Module>();
  return {
    ...actual,
    S3Client: vi.fn(() => ({ send: mockSend, destroy: vi.fn() })),
  };
});

async function drain(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

describe('storage keys', () => {
  it('sanitizes traversal, backslashes and duplicate slashes', () => {
    expect(sanitizeKey('/a//b\\c')).toBe('a/b/c');
    expect(sanitizeKey('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeKey('a/./b/../c')).toBe('a/b/c');
    expect(() => sanitizeKey('   ')).toThrow();
  });

  it('builds a dated, unique key preserving the extension', () => {
    const key = buildObjectKey(StoragePrefix.animalImages, 'Photo.JPEG');
    expect(key).toMatch(/^animals\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpeg$/);
    expect(buildObjectKey(StoragePrefix.animalImages, 'Photo.JPEG')).not.toBe(key);
  });
});

describe('InMemoryObjectStorage', () => {
  it('round-trips put -> head -> get -> delete', async () => {
    const storage = new InMemoryObjectStorage();
    const put = await storage.put('users/1/note.txt', 'hello world', { contentType: 'text/plain' });
    expect(put.key).toBe('users/1/note.txt');
    expect(put.size).toBe(11);

    const meta = await storage.head('users/1/note.txt');
    expect(meta?.size).toBe(11);
    expect(meta?.contentType).toBe('text/plain');
    expect(await storage.exists('users/1/note.txt')).toBe(true);

    const got = await storage.get('users/1/note.txt');
    expect(await drain(got.body)).toBe('hello world');

    await storage.delete('users/1/note.txt');
    expect(await storage.exists('users/1/note.txt')).toBe(false);
    expect(await storage.head('users/1/note.txt')).toBeNull();
  });

  it('rejects get() for a missing object with ObjectNotFoundError', async () => {
    await expect(new InMemoryObjectStorage().get('nope')).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('accepts Buffer and stream bodies', async () => {
    const storage = new InMemoryObjectStorage();
    await storage.put('a', Buffer.from('buf'));
    await storage.put('b', Readable.from(['str', 'eam']));
    expect(await drain((await storage.get('a')).body)).toBe('buf');
    expect(await drain((await storage.get('b')).body)).toBe('stream');
  });

  it('returns a public URL only when a base is configured', () => {
    expect(new InMemoryObjectStorage(null).getPublicUrl('x')).toBeNull();
    expect(new InMemoryObjectStorage('https://cdn.test/').getPublicUrl('/x/y')).toBe(
      'https://cdn.test/x/y',
    );
  });

  it('produces an expiring signed URL', async () => {
    const url = await new InMemoryObjectStorage().getSignedUrl('k', {
      operation: 'put',
      expiresIn: 60,
    });
    expect(url).toMatch(/^memory:\/\/k\?op=put&expires=\d+$/);
  });
});

describe('R2ObjectStorage (mapping logic, S3 mocked)', () => {
  const config: R2Config = {
    accountId: 'acc',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    bucket: 'bytari',
    endpoint: 'https://acc.r2.cloudflarestorage.com',
    publicBaseUrl: 'https://files.bytari.test',
    forcePathStyle: true,
    signedUrlTtlSeconds: 900,
  };

  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
    mockGetSignedUrl.mockResolvedValue('https://r2.example/signed');
  });

  it('builds a public URL from the configured base', () => {
    const storage = new R2ObjectStorage(config, silentLogger);
    expect(storage.getPublicUrl('animals/x.jpg')).toBe('https://files.bytari.test/animals/x.jpg');
  });

  it('put() forwards to S3 and returns the sanitized key + etag', async () => {
    mockSend.mockResolvedValueOnce({ ETag: '"etag123"' });
    const storage = new R2ObjectStorage(config, silentLogger);
    const res = await storage.put('/animals//x.jpg', Buffer.from('img'), {
      contentType: 'image/jpeg',
    });
    expect(res).toEqual({ key: 'animals/x.jpg', etag: '"etag123"', size: undefined });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('head() maps a 404 to null', async () => {
    mockSend.mockRejectedValueOnce({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });
    const storage = new R2ObjectStorage(config, silentLogger);
    expect(await storage.head('missing')).toBeNull();
  });

  it('get() maps a 404 to ObjectNotFoundError', async () => {
    mockSend.mockRejectedValueOnce({ name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const storage = new R2ObjectStorage(config, silentLogger);
    await expect(storage.get('missing')).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('getSignedUrl() delegates to the presigner', async () => {
    const storage = new R2ObjectStorage(config, silentLogger);
    expect(await storage.getSignedUrl('k', { operation: 'get', expiresIn: 120 })).toBe(
      'https://r2.example/signed',
    );
  });
});
