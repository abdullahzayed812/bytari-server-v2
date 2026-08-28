import type { Readable } from 'node:stream';

/**
 * Object-storage contract. Cloudflare R2 is the production implementation;
 * an in-memory implementation backs tests / local dev. Business modules depend
 * on {@link ObjectStorage} only and persist the returned `key` — never binaries
 * — in PostgreSQL.
 */

export type ObjectBody = Buffer | Uint8Array | Readable | string;

export interface PutObjectOptions {
  contentType?: string;
  /** `Cache-Control` header stored with the object. */
  cacheControl?: string;
  /** Arbitrary string metadata persisted alongside the object. */
  metadata?: Record<string, string>;
  /** Size hint in bytes (required by some backends for streaming uploads). */
  contentLength?: number;
}

export interface PutObjectResult {
  key: string;
  etag?: string;
  size?: number;
}

export interface ObjectMetadata {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  metadata: Record<string, string>;
}

export interface GetObjectResult {
  body: Readable;
  metadata: ObjectMetadata;
}

export interface SignedUrlOptions {
  operation: 'get' | 'put';
  /** Seconds until the URL expires. */
  expiresIn: number;
  contentType?: string;
}

export interface ObjectStorage {
  readonly name: string;

  put(key: string, body: ObjectBody, options?: PutObjectOptions): Promise<PutObjectResult>;
  get(key: string): Promise<GetObjectResult>;
  head(key: string): Promise<ObjectMetadata | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;

  /** Time-limited URL for direct client upload/download. */
  getSignedUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Stable public URL when the bucket/CDN is public, else `null`. */
  getPublicUrl(key: string): string | null;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class StorageNotConfiguredError extends Error {
  constructor(message = 'Object storage is not configured') {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}
