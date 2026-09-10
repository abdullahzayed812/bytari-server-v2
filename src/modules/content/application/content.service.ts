import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';
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
  type ContentCommentDTO,
  type ContentDTO,
  type ContentFile,
  type ContentRatingAggregate,
  type ListContentFilter,
} from '../domain/content.types.js';
import type { CategoryRepository } from '../infrastructure/category.repository.js';
import type { ContentCommentRepository } from '../infrastructure/content-comment.repository.js';
import type { ContentEngagementRepository } from '../infrastructure/content-engagement.repository.js';
import type { ContentFileRepository } from '../infrastructure/content-file.repository.js';
import type { ContentRatingRepository } from '../infrastructure/content-rating.repository.js';
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
  /** Book-only; ignored (stored as-is, but meaningless) for ARTICLE/MAGAZINE. */
  language?: string | null;
  pageCount?: number | null;
  publishYear?: number | null;
  categoryIds?: string[];
}

export interface UpdateContentInput {
  title?: string;
  description?: string | null;
  body?: string | null;
  authorName?: string | null;
  language?: string | null;
  pageCount?: number | null;
  publishYear?: number | null;
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
    private readonly engagement: ContentEngagementRepository,
    private readonly comments: ContentCommentRepository,
    private readonly ratings: ContentRatingRepository,
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

  private async dto(content: Content, admin: boolean, viewerId?: string): Promise<ContentDTO> {
    const [cats, fileList, ratingAgg, isBookmarked, isLiked] = await Promise.all([
      this.content.categoriesFor(content.id),
      this.files.listActiveForContent(content.id),
      this.ratings.aggregate(content.id),
      viewerId ? this.engagement.isBookmarked(viewerId, content.id) : Promise.resolve(false),
      viewerId ? this.engagement.isLiked(viewerId, content.id) : Promise.resolve(false),
    ]);
    return this.assemble(content, cats, fileList, admin, ratingAgg, { isBookmarked, isLiked });
  }

  private assemble(
    content: Content,
    cats: Category[],
    fileList: ContentFile[],
    admin: boolean,
    rating: ContentRatingAggregate,
    viewer: { isBookmarked: boolean; isLiked: boolean },
  ): ContentDTO {
    return {
      id: content.id,
      type: content.type,
      title: content.title,
      description: content.description,
      body: content.body,
      authorName: content.authorName,
      status: content.status,
      publishedAt: content.publishedAt,
      language: content.language,
      pageCount: content.pageCount,
      publishYear: content.publishYear,
      likeCount: content.likeCount,
      commentCount: content.commentCount,
      viewCount: content.viewCount,
      rating,
      isBookmarked: viewer.isBookmarked,
      isLiked: viewer.isLiked,
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
          language: input.language ?? null,
          pageCount: input.pageCount ?? null,
          publishYear: input.publishYear ?? null,
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
    return this.dto(content, true, actor.actorUserId);
  }

  async update(actor: ContentActor, id: string, input: UpdateContentInput): Promise<ContentDTO> {
    const existing = await this.load(id);
    const categoriesChanged = input.categoryIds !== undefined;
    if (categoriesChanged) await this.assertCategoriesExist(input.categoryIds ?? []);

    const fieldKeys = (
      ['title', 'description', 'body', 'authorName', 'language', 'pageCount', 'publishYear'] as const
    ).filter((k) => input[k] !== undefined);

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
            language: input.language,
            pageCount: input.pageCount,
            publishYear: input.publishYear,
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
    return this.dto(updated, true, actor.actorUserId);
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
    if (!changes) return this.dto(existing, true, actor.actorUserId); // idempotent no-op

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
    return this.dto(updated, true, actor.actorUserId);
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
    return this.dto(updated, true, actor.actorUserId);
  }

  // --- reads -----------------------------------------------

  async getAdmin(id: string, viewerId?: string): Promise<ContentDTO> {
    return this.dto(await this.load(id), true, viewerId);
  }

  /** Shared by listAdmin/listPublic — batches ratings + viewer state (no N+1). */
  private async assembleMany(
    items: Content[],
    admin: boolean,
    viewerId?: string,
  ): Promise<ContentDTO[]> {
    const ids = items.map((c) => c.id);
    const [fileMap, ratingMap, bookmarkedSet, likedSet] = await Promise.all([
      this.files.listActiveForContents(ids),
      this.ratings.aggregateMany(ids),
      viewerId ? this.engagement.bookmarkedSet(viewerId, ids) : Promise.resolve(new Set<string>()),
      viewerId ? this.engagement.likedSet(viewerId, ids) : Promise.resolve(new Set<string>()),
    ]);
    return Promise.all(
      items.map(async (c) =>
        this.assemble(
          c,
          await this.content.categoriesFor(c.id),
          fileMap.get(c.id) ?? [],
          admin,
          ratingMap.get(c.id) ?? { average: null, count: 0 },
          { isBookmarked: bookmarkedSet.has(c.id), isLiked: likedSet.has(c.id) },
        ),
      ),
    );
  }

  async listAdmin(filter: ListContentFilter): Promise<{ items: ContentDTO[]; total: number }> {
    const { items, total } = await this.content.list(filter, false);
    return { items: await this.assembleMany(items, true, filter.viewerId), total };
  }

  async getPublic(id: string, viewerId?: string): Promise<ContentDTO> {
    const c = await this.content.findById(id);
    if (!c || c.status !== 'PUBLISHED' || c.deletedAt !== null) {
      throw new NotFoundError('Content not found');
    }
    await this.content.incrementViewCount(id);
    return this.dto({ ...c, viewCount: c.viewCount + 1 }, false, viewerId);
  }

  async listPublic(filter: ListContentFilter): Promise<{ items: ContentDTO[]; total: number }> {
    const { items, total } = await this.content.list(filter, true);
    return { items: await this.assembleMany(items, false, filter.viewerId), total };
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

  // --- engagement: bookmarks / likes --------------------------
  //
  // Self-service, auth-only (no `content.*` permission needed — any signed-in
  // user may save/like a PUBLISHED item), mirrors `TipService.setBookmark` /
  // `setHelpful` exactly, including pairing the like toggle with the
  // denormalised `contents.like_count` update in the same transaction.

  private async assertPubliclyVisible(contentId: string): Promise<Content> {
    const c = await this.content.findById(contentId);
    if (!c || c.status !== 'PUBLISHED' || c.deletedAt !== null) {
      throw new NotFoundError('Content not found');
    }
    return c;
  }

  async setBookmark(userId: string, contentId: string, bookmarked: boolean): Promise<boolean> {
    await this.assertPubliclyVisible(contentId);
    return this.db.transaction(async (tx) => {
      if (bookmarked) {
        await this.engagement.addBookmark(userId, contentId, tx);
        return true;
      }
      await this.engagement.removeBookmark(userId, contentId, tx);
      return false;
    });
  }

  private async currentLikeCount(contentId: string, tx: Knex.Transaction): Promise<number> {
    const c = await this.content.findById(contentId, tx);
    return c?.likeCount ?? 0;
  }

  async setLike(
    userId: string,
    contentId: string,
    liked: boolean,
  ): Promise<{ isLiked: boolean; likeCount: number }> {
    await this.assertPubliclyVisible(contentId);
    const likeCount = await this.db.transaction(async (tx) => {
      if (liked) {
        const inserted = await this.engagement.addLike(userId, contentId, tx);
        return inserted
          ? this.content.adjustLikeCount(contentId, 1, tx)
          : this.currentLikeCount(contentId, tx);
      }
      const removed = await this.engagement.removeLike(userId, contentId, tx);
      return removed > 0
        ? this.content.adjustLikeCount(contentId, -1, tx)
        : this.currentLikeCount(contentId, tx);
    });
    return { isLiked: liked, likeCount };
  }

  // --- engagement: comments ------------------------------------

  private toCommentDTO(c: {
    id: string;
    contentId: string;
    userId: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    author: { firstName: string; lastName: string };
  }): ContentCommentDTO {
    return {
      id: c.id,
      contentId: c.contentId,
      userId: c.userId,
      authorName: c.author,
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  async listComments(
    contentId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: ContentCommentDTO[]; total: number }> {
    await this.assertPubliclyVisible(contentId);
    const { items, total } = await this.comments.listForContent(contentId, page, pageSize);
    return { items: items.map((c) => this.toCommentDTO(c)), total };
  }

  async addComment(userId: string, contentId: string, body: string): Promise<ContentCommentDTO> {
    await this.assertPubliclyVisible(contentId);
    const created = await this.db.transaction(async (tx) => {
      const comment = await this.comments.create(contentId, userId, body, tx);
      await this.content.adjustCommentCount(contentId, 1, tx);
      return comment;
    });
    const withAuthor = await this.comments.findByIdWithAuthor(created.id);
    if (!withAuthor) throw new Error('content comment not found immediately after creation');
    this.events.publish('content.comment.created', { contentId, commentId: created.id });
    return this.toCommentDTO(withAuthor);
  }

  /** Own comment only — no moderation delete for other users' comments yet. */
  async deleteComment(userId: string, contentId: string, commentId: string): Promise<void> {
    const comment = await this.comments.findById(commentId);
    if (!comment || comment.contentId !== contentId || comment.deletedAt !== null) {
      throw new NotFoundError('Comment not found');
    }
    if (comment.userId !== userId) {
      throw new ForbiddenError('You can only delete your own comment');
    }
    await this.db.transaction(async (tx) => {
      await this.comments.softDelete(commentId, tx);
      await this.content.adjustCommentCount(contentId, -1, tx);
    });
    this.events.publish('content.comment.deleted', { contentId, commentId });
  }

  // --- engagement: ratings (books) ------------------------------

  async getRating(
    contentId: string,
    viewerId?: string,
  ): Promise<{ aggregate: ContentRatingAggregate; myRating: number | null }> {
    await this.assertPubliclyVisible(contentId);
    const [aggregate, own] = await Promise.all([
      this.ratings.aggregate(contentId),
      viewerId ? this.ratings.findOwn(contentId, viewerId) : Promise.resolve(null),
    ]);
    return { aggregate, myRating: own?.rating ?? null };
  }

  async submitRating(
    userId: string,
    contentId: string,
    rating: number,
  ): Promise<ContentRatingAggregate> {
    await this.assertPubliclyVisible(contentId);
    await this.ratings.upsert(contentId, userId, rating);
    this.events.publish('content.rating.submitted', { contentId, userId, rating });
    return this.ratings.aggregate(contentId);
  }
}
