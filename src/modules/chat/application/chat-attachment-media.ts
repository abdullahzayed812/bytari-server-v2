import path from 'node:path';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { BadRequestError, ConflictError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import {
  CHAT_ATTACHMENT_FILENAME_MAX,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MIME,
  CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS,
  CHAT_ATTACHMENT_URL_TTL_SECONDS,
  type ChatAttachmentKind,
} from '../domain/chat.constants.js';
import type { MessageAttachment, MessageAttachmentDTO } from '../domain/chat.types.js';

export interface ChatAttachmentPresign {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/** A safe display name: basename only, no control chars, bounded length. */
export function safeFileName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'file').slice(0, CHAT_ATTACHMENT_FILENAME_MAX);
}

/**
 * Chat media on the EXISTING presigned-R2 flow. Objects are private and
 * namespaced per conversation (`chat/attachments/<conversationId>/…`), so a key
 * minted for one conversation can never be attached in another. Clients never
 * see a key: they get a short-lived signed GET URL, issued only after the
 * conversation access check. Public CDN URLs are deliberately NOT used.
 */
export class ChatAttachmentMedia {
  constructor(private readonly storage: ObjectStorage) {}

  private prefixFor(conversationId: string): string {
    return `${StoragePrefix.chatAttachments}/${conversationId}`;
  }

  private assertAllowed(kind: ChatAttachmentKind, mimeType: string, size: number): void {
    if (!Number.isInteger(size) || size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (size > CHAT_ATTACHMENT_MAX_BYTES[kind]) {
      throw new BadRequestError(
        `${kind.toLowerCase()} exceeds the ${CHAT_ATTACHMENT_MAX_BYTES[kind]}-byte limit`,
        { code: ErrorCode.FILE_TOO_LARGE },
      );
    }
    if (!CHAT_ATTACHMENT_MIME[kind].includes(mimeType)) {
      throw new BadRequestError(`MIME type "${mimeType}" is not allowed for a ${kind} attachment`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  }

  async presignUpload(
    conversationId: string,
    input: { kind: ChatAttachmentKind; filename: string; mimeType: string; size: number },
  ): Promise<ChatAttachmentPresign> {
    this.assertAllowed(input.kind, input.mimeType, input.size);
    const storageKey = buildObjectKey(this.prefixFor(conversationId), safeFileName(input.filename));
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS,
    };
  }

  /**
   * Verify an uploaded object before it is linked to a message: key issued for
   * THIS conversation, object exists, real size + verified type within the
   * kind's limits, and not already linked to another message.
   */
  async verify(
    conversationId: string,
    input: { kind: ChatAttachmentKind; storageKey: string; fileName: string },
    keyInUse: (key: string) => Promise<boolean>,
  ): Promise<MessageAttachment> {
    if (!input.storageKey.startsWith(`${this.prefixFor(conversationId)}/`)) {
      throw new BadRequestError('storage key does not belong to this conversation', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = (head.contentType ?? '').toLowerCase().split(';')[0]!.trim();
    this.assertAllowed(input.kind, realMime, head.size);
    if (await keyInUse(input.storageKey)) {
      throw new ConflictError('this attachment is already linked to a message');
    }
    return {
      kind: input.kind,
      storageKey: input.storageKey,
      fileName: safeFileName(input.fileName),
      mimeType: realMime,
      sizeBytes: head.size,
    };
  }

  /** Signed GET — ONLY call after the caller's conversation access was checked. */
  async toDTO(a: MessageAttachment): Promise<MessageAttachmentDTO> {
    const url = await this.storage.getSignedUrl(a.storageKey, {
      operation: 'get',
      expiresIn: CHAT_ATTACHMENT_URL_TTL_SECONDS,
    });
    return {
      kind: a.kind,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url,
      urlExpiresInSeconds: CHAT_ATTACHMENT_URL_TTL_SECONDS,
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.storage.delete(storageKey);
  }
}
