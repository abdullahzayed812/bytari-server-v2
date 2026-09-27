import type { Logger } from 'pino';
import type { AppConfig } from '../../config/index.js';
import { ContentSniffingObjectStorage } from './content-sniffing.js';
import { InMemoryObjectStorage } from './in-memory-object-storage.js';
import { R2ObjectStorage } from './r2-object-storage.js';
import type { ObjectStorage } from './types.js';

/**
 * Select the object storage implementation from configuration:
 *  - Cloudflare R2 when R2 credentials are present;
 *  - otherwise an in-memory store (dev / test) with a loud warning.
 */
export function createObjectStorage(config: AppConfig, logger: Logger): ObjectStorage {
  const r2 = config.storage.r2;
  if (r2) {
    logger.info({ bucket: r2.bucket }, 'object storage: cloudflare-r2 (content-type verified)');
    // Client-declared Content-Types of presigned uploads are re-checked
    // against the file's magic bytes before any module trusts them.
    return new ContentSniffingObjectStorage(new R2ObjectStorage(r2, logger));
  }
  logger.warn(
    'object storage: in-memory — Cloudflare R2 not configured. Uploaded files are volatile and NOT for production.',
  );
  return new InMemoryObjectStorage(null);
}
