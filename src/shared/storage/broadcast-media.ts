import { buildObjectKey, type ObjectStorage } from '../../infra/storage/index.js';
import { BadRequestError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { resolveStorageUrlOrNull } from './media-url.js';

/**
 * Image + link attachments for broadcast-style messages (admin broadcasts,
 * organization → followers / syndicate → members). The notification row keeps
 * the STORAGE KEY (`data.imageKey`), never a signed URL — a signed URL baked
 * into a row expires an hour later, which is why older broadcast images
 * disappeared. Readers resolve the key per request (`resolveNotificationImage`).
 */
export const BROADCAST_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const BROADCAST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 600;
const READ_URL_TTL_SECONDS = 3600;

export interface BroadcastImagePresign {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export async function presignBroadcastImage(
  storage: ObjectStorage,
  prefix: string,
  input: { filename: string; mimeType: string; size: number },
): Promise<BroadcastImagePresign> {
  if (!Number.isInteger(input.size) || input.size <= 0) {
    throw new BadRequestError('size must be a positive integer number of bytes');
  }
  if (input.size > BROADCAST_IMAGE_MAX_BYTES) {
    throw new BadRequestError(`image exceeds the ${BROADCAST_IMAGE_MAX_BYTES}-byte limit`, {
      code: ErrorCode.FILE_TOO_LARGE,
    });
  }
  if (!(BROADCAST_IMAGE_MIME as readonly string[]).includes(input.mimeType)) {
    throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
      code: ErrorCode.UNSUPPORTED_FILE_TYPE,
    });
  }
  const storageKey = buildObjectKey(prefix, input.filename);
  const uploadUrl = await storage.getSignedUrl(storageKey, {
    operation: 'put',
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    contentType: input.mimeType,
  });
  return {
    storageKey,
    uploadUrl,
    method: 'PUT',
    headers: { 'Content-Type': input.mimeType },
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
}

/** The key must live under `prefix` and the object must really exist (uploaded). */
export async function assertBroadcastImage(
  storage: ObjectStorage,
  prefix: string,
  key: string,
): Promise<void> {
  if (!key.startsWith(`${prefix}/`)) {
    throw new BadRequestError('storage key does not belong to broadcast uploads', {
      code: ErrorCode.STORAGE_KEY_MISMATCH,
    });
  }
  const head = await storage.head(key);
  if (!head) {
    throw new BadRequestError('no uploaded object exists at that storage key', {
      code: ErrorCode.STORAGE_OBJECT_MISSING,
    });
  }
  if (head.contentType && !(BROADCAST_IMAGE_MIME as readonly string[]).includes(head.contentType)) {
    throw new BadRequestError(`MIME type "${head.contentType}" is not allowed`, {
      code: ErrorCode.UNSUPPORTED_FILE_TYPE,
    });
  }
  if (head.size > BROADCAST_IMAGE_MAX_BYTES) {
    throw new BadRequestError(`image exceeds the ${BROADCAST_IMAGE_MAX_BYTES}-byte limit`, {
      code: ErrorCode.FILE_TOO_LARGE,
    });
  }
}

/**
 * `data.imageKey` → a fresh `data.imageUrl` (signed or public). Rows without a
 * key are returned unchanged (legacy rows may still carry a stored `imageUrl`).
 */
export async function resolveNotificationImage(
  storage: ObjectStorage | undefined,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const key = data.imageKey;
  if (!storage || typeof key !== 'string' || key.length === 0) return data;
  try {
    const imageUrl = await resolveStorageUrlOrNull(storage, key, READ_URL_TTL_SECONDS);
    const { imageKey: _omit, ...rest } = data;
    return imageUrl ? { ...rest, imageUrl } : rest;
  } catch {
    return data;
  }
}
