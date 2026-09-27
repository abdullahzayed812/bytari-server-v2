import { describe, expect, it } from 'vitest';
import {
  ContentSniffingObjectStorage,
  InMemoryObjectStorage,
  sniffContentType,
} from '../../src/infra/storage/index.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom0000', 'latin1')]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  0000', 'latin1')]);
const PDF = Buffer.from('%PDF-1.7\n', 'latin1');

describe('sniffContentType', () => {
  it('recognises the uploaded families', () => {
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
    expect(sniffContentType(PNG)).toBe('image/png');
    expect(sniffContentType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffContentType(MP4)).toBe('video/mp4');
    expect(sniffContentType(MOV)).toBe('video/quicktime');
    expect(sniffContentType(PDF)).toBe('application/pdf');
    expect(sniffContentType(Buffer.from('<html>', 'latin1'))).toBeNull();
  });
});

describe('ContentSniffingObjectStorage.head', () => {
  const make = async (bytes: Buffer, contentType: string) => {
    const inner = new InMemoryObjectStorage(null);
    await inner.put('k', bytes, { contentType });
    return new ContentSniffingObjectStorage(inner).head('k');
  };

  it('keeps a declared type that matches the bytes', async () => {
    expect((await make(JPEG, 'image/jpeg'))?.contentType).toBe('image/jpeg');
    expect((await make(JPEG, 'image/jpg'))?.contentType).toBe('image/jpeg');
    expect((await make(MOV, 'video/mp4'))?.contentType).toBe('video/mp4');
  });

  it('replaces a lying declared type with the real one / octet-stream', async () => {
    expect((await make(PNG, 'image/jpeg'))?.contentType).toBe('image/png');
    expect((await make(Buffer.from('<script>alert(1)</script>'), 'image/png'))?.contentType).toBe(
      'application/octet-stream',
    );
    expect((await make(Buffer.from('MZ\x90\x00'), 'application/pdf'))?.contentType).toBe(
      'application/octet-stream',
    );
  });

  it('leaves non-verifiable declared types alone; missing object → null', async () => {
    expect((await make(Buffer.from('PK\x03\x04'), 'application/msword'))?.contentType).toBe(
      'application/msword',
    );
    const s = new ContentSniffingObjectStorage(new InMemoryObjectStorage(null));
    expect(await s.head('missing')).toBeNull();
  });
});
