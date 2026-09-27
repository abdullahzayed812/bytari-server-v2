import type { Readable } from 'node:stream';
import type {
  GetObjectResult,
  ObjectBody,
  ObjectMetadata,
  ObjectStorage,
  PutObjectOptions,
  PutObjectResult,
  SignedUrlOptions,
} from './types.js';

/** Bytes read from the start of an object to identify its real type. */
export const SNIFF_PREFIX_BYTES = 64;

/**
 * Identify a file's real type from its leading "magic" bytes. Covers the
 * families the app uploads (images, PDF, video). `null` = not recognised.
 */
export function sniffContentType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  const ascii = (start: number, end: number): string => b.subarray(start, end).toString('latin1');
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return 'video/webm';
  }
  if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand.startsWith('3g')) return 'video/3gpp';
    if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
    return 'video/mp4';
  }
  return null;
}

/**
 * Declared types we can (and therefore must) verify against the bytes. For
 * anything else (e.g. office documents) the declared type is kept as-is and
 * the per-module allow-lists decide.
 */
function isVerifiable(declared: string | undefined): boolean {
  if (!declared) return false;
  const t = declared.toLowerCase().split(';')[0]!.trim();
  return t.startsWith('image/') || t.startsWith('video/') || t === 'application/pdf';
}

/** `image/jpg` is a common non-standard alias of `image/jpeg`. */
function normalise(type: string): string {
  const t = type.toLowerCase().split(';')[0]!.trim();
  return t === 'image/jpg' ? 'image/jpeg' : t;
}

/** Families whose sniffed sub-type may legitimately differ from the declared one. */
function sameFamily(declared: string, sniffed: string): boolean {
  const iso = ['video/mp4', 'video/quicktime', 'video/3gpp', 'video/x-m4v'];
  if (iso.includes(declared) && iso.includes(sniffed)) return true;
  const heif = ['image/heic', 'image/heif'];
  return heif.includes(declared) && heif.includes(sniffed);
}

async function readStreamPrefix(stream: Readable, n: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      chunks.push(buf);
      total += buf.length;
      if (total >= n) break;
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks).subarray(0, n);
}

/**
 * {@link ObjectStorage} decorator that makes `head().contentType` trustworthy.
 *
 * Every upload finaliser in the app validates the uploaded object from
 * `head()` — but for a presigned direct upload that Content-Type is whatever
 * the CLIENT sent with its PUT. This decorator re-derives it: when the
 * declared type is a verifiable family (image / video / PDF) the first bytes
 * are read and, if they do not match, `contentType` is replaced by the
 * detected type — or `application/octet-stream` when unrecognised — so the
 * caller's existing MIME allow-list rejects the object. A matching object is
 * reported with its canonical type.
 */
export class ContentSniffingObjectStorage implements ObjectStorage {
  constructor(
    private readonly inner: ObjectStorage & {
      readPrefix?: (key: string, n: number) => Promise<Buffer>;
    },
  ) {}

  get name(): string {
    return this.inner.name;
  }

  put(key: string, body: ObjectBody, options?: PutObjectOptions): Promise<PutObjectResult> {
    return this.inner.put(key, body, options);
  }

  get(key: string): Promise<GetObjectResult> {
    return this.inner.get(key);
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const meta = await this.inner.head(key);
    if (!meta || !isVerifiable(meta.contentType)) return meta;
    const declared = normalise(meta.contentType as string);
    const prefix = this.inner.readPrefix
      ? await this.inner.readPrefix(key, SNIFF_PREFIX_BYTES)
      : await readStreamPrefix((await this.inner.get(key)).body, SNIFF_PREFIX_BYTES);
    const sniffed = sniffContentType(prefix);
    if (sniffed && (sniffed === declared || sameFamily(declared, sniffed))) {
      return { ...meta, contentType: declared };
    }
    return { ...meta, contentType: sniffed ?? 'application/octet-stream' };
  }

  exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    return this.inner.getSignedUrl(key, options);
  }

  getPublicUrl(key: string): string | null {
    return this.inner.getPublicUrl(key);
  }
}
