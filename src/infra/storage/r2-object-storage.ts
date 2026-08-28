import type { Readable } from 'node:stream';
import type { Logger } from 'pino';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { R2Config } from '../../config/index.js';
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

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/**
 * Cloudflare R2 implementation of {@link ObjectStorage} via the S3-compatible
 * API. Credentials come from validated env config only.
 *
 * Note: streaming uploads without a known `contentLength` may be rejected by R2.
 * Prefer passing a `Buffer`, or set `options.contentLength`.
 */
export class R2ObjectStorage implements ObjectStorage {
  readonly name = 'cloudflare-r2';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;
  private readonly defaultTtl: number;
  private readonly log: Logger;

  constructor(config: R2Config, logger: Logger) {
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;
    this.defaultTtl = config.signedUrlTtlSeconds;
    this.log = logger.child({ component: 'storage', provider: 'cloudflare-r2' });
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(key: string, body: ObjectBody, options?: PutObjectOptions): Promise<PutObjectResult> {
    const id = sanitizeKey(key);
    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: id,
      Body: body,
      ContentType: options?.contentType,
      CacheControl: options?.cacheControl,
      Metadata: options?.metadata,
      ContentLength: options?.contentLength,
    };
    const res = await this.client.send(new PutObjectCommand(input));
    return { key: id, etag: res.ETag, size: options?.contentLength };
  }

  async get(key: string): Promise<GetObjectResult> {
    const id = sanitizeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: id }));
      if (!res.Body) throw new ObjectNotFoundError(id);
      return {
        body: res.Body as Readable,
        metadata: {
          key: id,
          size: res.ContentLength ?? 0,
          contentType: res.ContentType,
          etag: res.ETag,
          lastModified: res.LastModified,
          metadata: res.Metadata ?? {},
        },
      };
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError(id);
      throw err;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const id = sanitizeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: id }));
      return {
        key: id,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        etag: res.ETag,
        lastModified: res.LastModified,
        metadata: res.Metadata ?? {},
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    const id = sanitizeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: id }));
  }

  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const id = sanitizeKey(key);
    const expiresIn = options.expiresIn || this.defaultTtl;
    const command =
      options.operation === 'put'
        ? new PutObjectCommand({ Bucket: this.bucket, Key: id, ContentType: options.contentType })
        : new GetObjectCommand({ Bucket: this.bucket, Key: id });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  getPublicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/${sanitizeKey(key)}`;
  }

  destroy(): void {
    this.client.destroy();
    this.log.debug('r2 client destroyed');
  }
}
