import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  type ContentFileKind,
  type ContentType,
} from '../domain/content.constants.js';
import { ContentPolicy } from '../domain/content.policy.js';
import {
  toAdminFileDTO,
  toPublicFileDTO,
  type Category,
  type Content,
  type ContentDTO,
  type ContentFile,
  type ListContentFilter,
} from '../domain/content.types.js';
import type { CategoryRepository } from '../infrastructure/category.repository.js';
import type { ContentFileRepository } from '../infrastructure/content-file.repository.js';
import type { ContentRepository } from '../infrastructure/content.repository.js';

export interface ContentActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateContentInput {
  type: ContentType;
  title: string;
  description?: string | null;
  body?: string | null;
  authorName?: string | null;
  categoryIds?: string[];
}

export interface UpdateContentInput {
  title?: string;
  description?: string | null;
  body?: string | null;
  authorName?: string | null;
  categoryIds?: string[];
}

const UPLOAD_URL_TTL_SECONDS = 600;

function prefixFor(type: ContentType): string {
  if (type === 'BOOK') return StoragePrefix.books;
  if (type === 'MAGAZINE') return StoragePrefix.magazines;
  return StoragePrefix.articles;
}

/**
 * Content lifecycle + files + categories. Authorization is done by the route
 * `authorize('content.*')` middleware (ADMIN override / CONTENT supervisor
 * domain); this service enforces the state machine, storage-key safety and the
 * public-visibility rule (only PUBLISHED & not-deleted content is user-visible).
 *
 * Storage: presigned direct-to-R2 upload. The DB transaction is NEVER held open
 * across a storage call. On file replace/delete the old object is removed
 * best-effort AFTER commit; a storage failure there is logged, never rolled
 * back (§28). An abandoned presigned upload (URL issued, never registered)
 * leaves an unreferenced object — swept by a future retention job (documented).
 */
export class ContentService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly content: ContentRepository,
    private readonly files: ContentFileRepository,
    private readonly categories: CategoryRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'content-service' });
  }

  // --- helpers ---------------------------------------------------

  private async load(id: string): Promise<Content> {
    const c = await this.content.findById(id);
    if (!c) throw new NotFoundError('Content not found');
    return c;
  }

  private async assertCategoriesExist(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.categories.findExistingIds([...new Set(ids)]);
    const missing = [...new Set(ids)].filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestError(`unknown categoryIds: ${missing.join(', ')}`);
    }
  }

  private async dto(content: Content, admin: boolean): Promise<ContentDTO> {
    const [cats, fileList] = await Promise.all([
      this.content.categoriesFor(content.id),
      this.files.listActiveForContent(content.id),
    ]);
    return this.assemble(content, cats, fileList, admin);
  }

  private async resolveCoverUrl(fileList: ContentFile[]): Promise<string | null> {
    const cover = fileList.find((f) => f.kind === 'COVER' && f.deletedAt === null);
    if (!cover) return null;
    return (
      this.storage.getPublicUrl(cover.storageKey) ??
      (await this.storage.getSignedUrl(cover.storageKey, { operation: 'get', expiresIn: 3600 }))
    );
  }

  private async assemble(
    content: Content,
    cats: Category[],
    fileList: ContentFile[],
    admin: boolean,
  ): Promise<ContentDTO> {
    return {
      id: content.id,
      type: content.type,
      title: content.title,
      description: content.description,
      body: content.body,
      authorName: content.authorName,
      status: content.status,
      publishedAt: content.publishedAt,
      coverImageUrl: await this.resolveCoverUrl(fileList),
      categories: cats,
      files: admin ? fileList.map(toAdminFileDTO) : fileList.map(toPublicFileDTO),
      createdByUserId: content.createdByUserId,
      updatedByUserId: content.updatedByUserId,
      deletedAt: content.deletedAt,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    };
  }

  // --- create / update ----------------------------------------

  async create(actor: ContentActor, input: CreateContentInput): Promise<ContentDTO> {
    const categoryIds = input.categoryIds ?? [];
    await this.assertCategoriesExist(categoryIds);

    const content = await this.db.transaction(async (tx) => {
      const created = await this.content.create(
        {
          type: input.type,
          title: input.title,
          description: input.description ?? null,
          body: input.body ?? null,
          authorName: input.authorName ?? null,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.content.replaceCategories(created.id, categoryIds, tx);
      await this.audit.record(
        {
          action: AuditAction.CONTENT_CREATED,
          entityType: AuditEntityType.CONTENT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: {
            contentId: created.id,
            type: created.type,
            categoryCount: categoryIds.length,
          },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('content.created', {
      contentId: content.id,
      type: content.type,
      status: content.status,
    });
    return this.dto(content, true);
  }

  async update(actor: ContentActor, id: string, input: UpdateContentInput): Promise<ContentDTO> {
    const existing = await this.load(id);
    const categoriesChanged = input.categoryIds !== undefined;
    if (categoriesChanged) await this.assertCategoriesExist(input.categoryIds ?? []);

    const fieldKeys = (['title', 'description', 'body', 'authorName'] as const).filter(
      (k) => input[k] !== undefined,
    );

    const updated = await this.db.transaction(async (tx) => {
      let next = existing;
      if (fieldKeys.length > 0) {
        next = await this.content.update(
          id,
          {
            title: input.title,
            description: input.description,
            body: input.body,
            authorName: input.authorName,
            updatedByUserId: actor.actorUserId,
          },
          tx,
        );
      }
      if (categoriesChanged) {
        await this.content.replaceCategories(id, input.categoryIds ?? [], tx);
      }
      await this.audit.record(
        {
          action: AuditAction.CONTENT_UPDATED,
          entityType: AuditEntityType.CONTENT,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: {
            contentId: id,
            fields: fieldKeys,
            categoriesChanged,
          },
          context: actor.context,
        },
        tx,
      );
      return next;
    });

    this.events.publish('content.updated', { contentId: id, type: updated.type });
    return this.dto(updated, true);
  }

  // --- lifecycle --------------------------------------------

  private async transition(
    actor: ContentActor,
    id: string,
    to: 'PUBLISHED' | 'ARCHIVED',
    changes: boolean,
    setPublishedAt: boolean,
    action: string,
    eventName: string,
  ): Promise<ContentDTO> {
    const existing = await this.load(id);
    if (!changes) return this.dto(existing, true); // idempotent no-op

    const updated = await this.db.transaction(async (tx) => {
      const next = await this.content.setStatus(id, to, actor.actorUserId, { setPublishedAt }, tx);
      await this.audit.record(
        {
          action,
          entityType: AuditEntityType.CONTENT,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { contentId: id, from: existing.status, to },
          context: actor.context,
        },
        tx,
      );
      return next;
    });

    this.events.publish(eventName, { contentId: id, type: updated.type, status: to });
    return this.dto(updated, true);
  }

  publish(actor: ContentActor, id: string): Promise<ContentDTO> {
    return this.load(id).then((c) =>
      this.transition(
        actor,
        id,
        'PUBLISHED',
        ContentPolicy.assertCanPublish(c.status),
        c.publishedAt === null,
        AuditAction.CONTENT_PUBLISHED,
        'content.published',
      ),
    );
  }

  archive(actor: ContentActor, id: string): Promise<ContentDTO> {
    return this.load(id).then((c) =>
      this.transition(
        actor,
        id,
        'ARCHIVED',
        ContentPolicy.assertCanArchive(c.status),
        false,
        AuditAction.CONTENT_ARCHIVED,
        'content.archived',
      ),
    );
  }

  async setDeleted(actor: ContentActor, id: string, deleted: boolean): Promise<ContentDTO> {
    const existing = await this.load(id);
    if ((existing.deletedAt !== null) === deleted) return this.dto(existing, true); // idempotent

    const updated = await this.db.transaction(async (tx) => {
      const next = await this.content.setDeleted(id, deleted, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: deleted ? AuditAction.CONTENT_DELETED : AuditAction.CONTENT_RESTORED,
          entityType: AuditEntityType.CONTENT,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { contentId: id },
          context: actor.context,
        },
        tx,
      );
      return next;
    });

    this.events.publish(deleted ? 'content.deleted' : 'content.restored', {
      contentId: id,
      type: updated.type,
    });
    return this.dto(updated, true);
  }

  // --- reads -----------------------------------------------

  async getAdmin(id: string): Promise<ContentDTO> {
    return this.dto(await this.load(id), true);
  }

  async listAdmin(filter: ListContentFilter): Promise<{ items: ContentDTO[]; total: number }> {
    const { items, total } = await this.content.list(filter, false);
    const fileMap = await this.files.listActiveForContents(items.map((c) => c.id));
    const dtos = await Promise.all(
      items.map(async (c) =>
        this.assemble(c, await this.content.categoriesFor(c.id), fileMap.get(c.id) ?? [], true),
      ),
    );
    return { items: dtos, total };
  }

  async getPublic(id: string): Promise<ContentDTO> {
    const c = await this.content.findById(id);
    if (!c || c.status !== 'PUBLISHED' || c.deletedAt !== null) {
      throw new NotFoundError('Content not found');
    }
    return this.dto(c, false);
  }

  async listPublic(filter: ListContentFilter): Promise<{ items: ContentDTO[]; total: number }> {
    const { items, total } = await this.content.list(filter, true);
    const fileMap = await this.files.listActiveForContents(items.map((c) => c.id));
    const dtos = await Promise.all(
      items.map(async (c) =>
        this.assemble(c, await this.content.categoriesFor(c.id), fileMap.get(c.id) ?? [], false),
      ),
    );
    return { items: dtos, total };
  }

  // --- files -----------------------------------------------

  async requestUploadUrl(
    contentId: string,
    input: { kind: ContentFileKind; filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    const content = await this.load(contentId);
    ContentPolicy.assertFileUploadRequest(input.kind, input.mimeType, input.size);

    // The server ALWAYS generates the key — the client never controls it.
    const storageKey = buildObjectKey(prefixFor(content.type), input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
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

  async registerFile(
    actor: ContentActor,
    contentId: string,
    input: {
      storageKey: string;
      kind: ContentFileKind;
      filename: string;
      mimeType: string;
      checksum?: string | null;
    },
  ): Promise<ContentDTO> {
    const content = await this.load(contentId);
    ContentPolicy.assertKeyBelongsToPrefix(input.storageKey, prefixFor(content.type));

    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    ContentPolicy.assertRegisteredFile(input.kind, realMime, head.size);

    const singleKind = input.kind === 'MAIN' || input.kind === 'COVER';
    const previous = singleKind ? await this.files.findActiveByKind(contentId, input.kind) : null;
    const replaced = previous !== null && previous.storageKey !== input.storageKey;

    await this.db.transaction(async (tx) => {
      if (previous) await this.files.softDelete(previous.id, tx);
      const created = await this.files.create(
        {
          contentId,
          kind: input.kind,
          storageKey: input.storageKey,
          storageProvider: this.storage.name,
          originalFilename: input.filename,
          mimeType: realMime,
          sizeBytes: head.size,
          checksum: input.checksum ?? null,
          uploadedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: replaced ? AuditAction.CONTENT_FILE_REPLACED : AuditAction.CONTENT_FILE_UPLOADED,
          entityType: AuditEntityType.CONTENT_FILE,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          // NB: no storage key / URL / credentials in audit metadata.
          metadata: { contentId, fileId: created.id, kind: input.kind, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
    });

    // Best-effort cleanup of the replaced object AFTER commit (§28).
    if (replaced && previous) {
      try {
        await this.storage.delete(previous.storageKey);
      } catch (err) {
        this.log.error(
          { err, contentId, fileId: previous.id },
          'failed to delete replaced storage object — needs a sweep',
        );
      }
    }

    this.events.publish(replaced ? 'content.file.replaced' : 'content.file.uploaded', {
      contentId,
      kind: input.kind,
    });
    return this.dto(content, true);
  }

  async deleteFile(actor: ContentActor, contentId: string, fileId: string): Promise<ContentDTO> {
    const content = await this.load(contentId);
    const file = await this.files.findByIdForContent(fileId, contentId);
    if (!file) throw new NotFoundError('Content file not found');
    if (file.deletedAt !== null) return this.dto(content, true); // idempotent

    await this.db.transaction(async (tx) => {
      await this.files.softDelete(fileId, tx);
      await this.audit.record(
        {
          action: AuditAction.CONTENT_FILE_DELETED,
          entityType: AuditEntityType.CONTENT_FILE,
          entityId: fileId,
          actorUserId: actor.actorUserId,
          metadata: { contentId, fileId, kind: file.kind },
          context: actor.context,
        },
        tx,
      );
    });

    try {
      await this.storage.delete(file.storageKey);
    } catch (err) {
      this.log.error({ err, contentId, fileId }, 'failed to delete storage object — needs a sweep');
    }

    this.events.publish('content.file.deleted', { contentId, kind: file.kind });
    return this.dto(content, true);
  }

  async fileDownloadUrl(
    contentId: string,
    fileId: string,
    opts: { requirePublished: boolean },
  ): Promise<{ url: string; expiresInSeconds: number | null }> {
    const content = await this.load(contentId);
    if (opts.requirePublished && (content.status !== 'PUBLISHED' || content.deletedAt !== null)) {
      throw new NotFoundError('Content not found');
    }
    const file = await this.files.findByIdForContent(fileId, contentId);
    if (!file || file.deletedAt !== null) throw new NotFoundError('Content file not found');

    const publicUrl = this.storage.getPublicUrl(file.storageKey);
    if (publicUrl) return { url: publicUrl, expiresInSeconds: null };

    const url = await this.storage.getSignedUrl(file.storageKey, {
      operation: 'get',
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }
}
