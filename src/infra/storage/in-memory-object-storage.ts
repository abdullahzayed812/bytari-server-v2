import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  ObjectNotFoundError,
  type GetObjectResult,
  type ObjectBody,
  type ObjectMetadata,
  type ObjectStorage,
  type PutObjectOptions,
  type PutObjectResult,
  type SignedUrlOptions,
} from './types.js';
import { sanitizeKey } from './keys.js';

interface StoredObject {
  data: Buffer;
  contentType?: string;
  metadata: Record<string, string>;
  etag: string;
  lastModified: Date;
}

async function bodyToBuffer(body: ObjectBody): Promise<Buffer> {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Volatile {@link ObjectStorage} kept entirely in memory. For tests and local
 * development only — production requires Cloudflare R2.
 */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly name = 'in-memory';
  private readonly objects = new Map<string, StoredObject>();

  constructor(private readonly publicBaseUrl: string | null = null) {}

  async put(key: string, body: ObjectBody, options?: PutObjectOptions): Promise<PutObjectResult> {
    const id = sanitizeKey(key);
    const data = await bodyToBuffer(body);
    const etag = createHash('md5').update(data).digest('hex');
    this.objects.set(id, {
      data,
      contentType: options?.contentType,
      metadata: options?.metadata ?? {},
      etag,
      lastModified: new Date(),
    });
    return { key: id, etag, size: data.byteLength };
  }

  get(key: string): Promise<GetObjectResult> {
    const id = sanitizeKey(key);
    const obj = this.objects.get(id);
    if (!obj) return Promise.reject(new ObjectNotFoundError(id));
    return Promise.resolve({
      body: Readable.from(obj.data),
      metadata: this.toMetadata(id, obj),
    });
  }

  head(key: string): Promise<ObjectMetadata | null> {
    const id = sanitizeKey(key);
    const obj = this.objects.get(id);
    return Promise.resolve(obj ? this.toMetadata(id, obj) : null);
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(sanitizeKey(key)));
  }

  delete(key: string): Promise<void> {
    this.objects.delete(sanitizeKey(key));
    return Promise.resolve();
  }

  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const id = sanitizeKey(key);
    const expiresAt = Date.now() + options.expiresIn * 1000;
    return Promise.resolve(`memory://${id}?op=${options.operation}&expires=${expiresAt}`);
  }

  getPublicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/${sanitizeKey(key)}`;
  }

  /** Test helper. */
  clear(): void {
    this.objects.clear();
  }

  private toMetadata(key: string, obj: StoredObject): ObjectMetadata {
    return {
      key,
      size: obj.data.byteLength,
      contentType: obj.contentType,
      etag: obj.etag,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
    };
  }
}
