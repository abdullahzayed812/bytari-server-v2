import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { ContentPolicy } from '../domain/content.policy.js';
import {
  ALERT_NOTE_MAX,
  ALLOWED_IMAGE_MIME,
  BODY_MAX,
  IMAGE_URL_TTL_SECONDS,
  MAX_GALLERY_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_POINTS,
  POINT_MAX,
  SOURCE_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
  isNewsTag,
  type NewsTag,
} from '../domain/news.constants.js';
import type {
  AdminNewsDTO,
  ListAdminNewsFilter,
  ListNewsFilter,
  NewsDTO,
  NewsListItemDTO,
} from '../domain/news.types.js';
import type { CategoryRepository } from '../infrastructure/category.repository.js';
import type {
  NewsBookmarkRepository,
  NewsRepository,
  NewsWithCategory,
} from '../infrastructure/news.repository.js';

export interface NewsActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateNewsInput {
  title: string;
  summary?: string | null;
  source?: string | null;
  isFeatured?: boolean;
  tag?: NewsTag;
  categoryId?: string | null;
  body?: string | null;
  reasonPoints?: string[];
  advicePoints?: string[];
  alertNote?: string | null;
}

export type UpdateNewsInput = Partial<CreateNewsInput>;

const UPLOAD_URL_TTL_SECONDS = 600;

function assertTitle(title: string): void {
  if (title.trim().length === 0 || title.length > TITLE_MAX) {
    throw new BadRequestError(`title must be 1-${TITLE_MAX} characters`);
  }
}
function assertMaxLen(value: string | null | undefined, max: number, field: string): void {
  if (value != null && value.length > max) {
    throw new BadRequestError(`${field} must be at most ${max} characters`);
  }
}
function assertPoints(points: string[] | undefined, field: string): void {
  if (points === undefined) return;
  if (points.length > MAX_POINTS) {
    throw new BadRequestError(`${field} may have at most ${MAX_POINTS} items`);
  }
  for (const p of points) {
    if (p.trim().length === 0 || p.length > POINT_MAX) {
      throw new BadRequestError(`each ${field} item must be 1-${POINT_MAX} characters`);
    }
  }
}

/**
 * "News" lifecycle + bookmark engagement inside the content module — the same
 * shape as {@link TipService}. Management authorization is the route
 * `authorizeContent('content.*')` middleware (ADMIN override / approved-vet
 * CONTENT supervisor). Public reads require only authentication; only
 * PUBLISHED, not-deleted news is visible. Cover + gallery images use the
 * presigned direct-to-R2 flow; a DB transaction never wraps a storage call.
 */
export class NewsService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly news: NewsRepository,
    private readonly bookmarks: NewsBookmarkRepository,
    private readonly categories: CategoryRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'news-service' });
  }

  // --- helpers --------------------------------------------------

  private async load(id: string): Promise<NewsWithCategory> {
    const nw = await this.news.findById(id);
    if (!nw) throw new NotFoundError('News not found');
    return nw;
  }

  private async loadVisible(id: string): Promise<NewsWithCategory> {
    const nw = await this.load(id);
    if (nw.news.status !== 'PUBLISHED' || nw.news.deletedAt) {
      throw new NotFoundError('News not found');
    }
    return nw;
  }

  private async assertCategory(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const found = await this.categories.findExistingIds([id]);
    if (!found.has(id)) throw new BadRequestError(`unknown categoryId: ${id}`);
  }

  private validateContent(input: CreateNewsInput | UpdateNewsInput): void {
    if (input.tag !== undefined && !isNewsTag(input.tag)) {
      throw new BadRequestError('tag must be NORMAL, URGENT or IMPORTANT_ALERT');
    }
    assertMaxLen(input.summary, SUMMARY_MAX, 'summary');
    assertMaxLen(input.source, SOURCE_MAX, 'source');
    assertMaxLen(input.body, BODY_MAX, 'body');
    assertMaxLen(input.alertNote, ALERT_NOTE_MAX, 'alertNote');
    assertPoints(input.reasonPoints, 'reasonPoints');
    assertPoints(input.advicePoints, 'advicePoints');
  }

  private resolveImageUrl(key: string): Promise<string> | string {
    const publicUrl = this.storage.getPublicUrl(key);
    if (publicUrl) return publicUrl;
    return this.storage.getSignedUrl(key, { operation: 'get', expiresIn: IMAGE_URL_TTL_SECONDS });
  }

  private async resolveGallery(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    return Promise.all(keys.map(async (k) => this.resolveImageUrl(k)));
  }

  private async listItem(nw: NewsWithCategory, isBookmarked: boolean): Promise<NewsListItemDTO> {
    const { news, category } = nw;
    return {
      id: news.id,
      title: news.title,
      summary: news.summary,
      source: news.source,
      isFeatured: news.isFeatured,
      tag: news.tag,
      category,
      coverImageUrl: news.coverImageStorageKey
        ? await this.resolveImageUrl(news.coverImageStorageKey)
        : null,
      bookmarkCount: news.bookmarkCount,
      isBookmarked,
      publishedAt: news.publishedAt,
    };
  }

  private async detail(nw: NewsWithCategory, isBookmarked: boolean): Promise<NewsDTO> {
    const base = await this.listItem(nw, isBookmarked);
    return {
      ...base,
      body: nw.news.body,
      reasonPoints: nw.news.reasonPoints,
      advicePoints: nw.news.advicePoints,
      alertNote: nw.news.alertNote,
      galleryUrls: await this.resolveGallery(nw.news.galleryKeys),
      updatedAt: nw.news.updatedAt,
    };
  }

  private async adminDetail(nw: NewsWithCategory): Promise<AdminNewsDTO> {
    const d = await this.detail(nw, false);
    return {
      ...d,
      status: nw.news.status,
      createdByUserId: nw.news.createdByUserId,
      updatedByUserId: nw.news.updatedByUserId,
      createdAt: nw.news.createdAt,
    };
  }

  // --- management: create / update ----------------------------

  async createNews(actor: NewsActor, input: CreateNewsInput): Promise<AdminNewsDTO> {
    assertTitle(input.title);
    this.validateContent(input);
    await this.assertCategory(input.categoryId);

    const created = await this.db.transaction(async (tx) => {
      const item = await this.news.create(
        {
          categoryId: input.categoryId ?? null,
          title: input.title,
          summary: input.summary ?? null,
          source: input.source ?? null,
          isFeatured: input.isFeatured ?? false,
          tag: input.tag ?? 'NORMAL',
          body: input.body ?? null,
          reasonPoints: input.reasonPoints ?? [],
          advicePoints: input.advicePoints ?? [],
          alertNote: input.alertNote ?? null,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.NEWS_CREATED,
          entityType: AuditEntityType.NEWS,
          entityId: item.id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: item.id },
          context: actor.context,
        },
        tx,
      );
      return item;
    });

    return this.adminDetail(await this.load(created.id));
  }

  async updateNews(actor: NewsActor, id: string, input: UpdateNewsInput): Promise<AdminNewsDTO> {
    await this.load(id);
    if (input.title !== undefined) assertTitle(input.title);
    this.validateContent(input);
    if (input.categoryId !== undefined) await this.assertCategory(input.categoryId);

    await this.db.transaction(async (tx) => {
      await this.news.update(
        id,
        {
          categoryId: input.categoryId,
          title: input.title,
          summary: input.summary,
          source: input.source,
          isFeatured: input.isFeatured,
          tag: input.tag,
          body: input.body,
          reasonPoints: input.reasonPoints,
          advicePoints: input.advicePoints,
          alertNote: input.alertNote,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.NEWS_UPDATED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id, fields: Object.keys(input) },
          context: actor.context,
        },
        tx,
      );
    });

    return this.adminDetail(await this.load(id));
  }

  // --- management: lifecycle ---------------------------------

  async publishNews(actor: NewsActor, id: string): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    const changes = ContentPolicy.assertCanPublish(news.status);
    if (!changes) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.news.setStatus(id, 'PUBLISHED', actor.actorUserId, { setPublishedAt: true }, tx);
      await this.audit.record(
        {
          action: AuditAction.NEWS_PUBLISHED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async archiveNews(actor: NewsActor, id: string): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    const changes = ContentPolicy.assertCanArchive(news.status);
    if (!changes) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.news.setStatus(id, 'ARCHIVED', actor.actorUserId, { setPublishedAt: false }, tx);
      await this.audit.record(
        {
          action: AuditAction.NEWS_ARCHIVED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async setDeleted(actor: NewsActor, id: string, deleted: boolean): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    if ((news.deletedAt !== null) === deleted) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.news.setDeleted(id, deleted, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: deleted ? AuditAction.NEWS_DELETED : AuditAction.NEWS_RESTORED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async setFeatured(actor: NewsActor, id: string, on: boolean): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    if (news.isFeatured === on) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.news.update(id, { isFeatured: on, updatedByUserId: actor.actorUserId }, tx);
      await this.audit.record(
        {
          action: AuditAction.NEWS_FEATURED_SET,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id, isFeatured: on },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  // --- management: cover image ------------------------------

  async requestCoverUploadUrl(
    id: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<UploadUrlResult> {
    await this.load(id);
    return this.presign(input);
  }

  async registerCover(
    actor: NewsActor,
    id: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    await this.assertUploadedObject(input);
    const previousKey = news.coverImageStorageKey;

    await this.db.transaction(async (tx) => {
      await this.news.setCoverImage(
        id,
        {
          storageKey: input.storageKey,
          storageProvider: this.storage.name,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.NEWS_COVER_UPDATED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id },
          context: actor.context,
        },
        tx,
      );
    });

    if (previousKey && previousKey !== input.storageKey) {
      await this.sweep(previousKey, id);
    }
    return this.adminDetail(await this.load(id));
  }

  // --- management: gallery (الصور المرفقة) --------------------

  async requestGalleryUploadUrl(
    id: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<UploadUrlResult> {
    const { news } = await this.load(id);
    if (news.galleryKeys.length >= MAX_GALLERY_IMAGES) {
      throw new BadRequestError(
        `the gallery already has the maximum of ${MAX_GALLERY_IMAGES} photos`,
        {
          code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
        },
      );
    }
    return this.presign(input);
  }

  async addGalleryImage(
    actor: NewsActor,
    id: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    await this.assertUploadedObject(input);
    if (news.galleryKeys.length >= MAX_GALLERY_IMAGES) {
      throw new BadRequestError(
        `the gallery already has the maximum of ${MAX_GALLERY_IMAGES} photos`,
        {
          code: ErrorCode.GALLERY_LIMIT_EXCEEDED,
        },
      );
    }
    const keys = [...news.galleryKeys, input.storageKey];

    await this.db.transaction(async (tx) => {
      await this.news.setGalleryKeys(id, keys, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.NEWS_GALLERY_UPDATED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id, photoCount: keys.length },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async removeGalleryImage(
    actor: NewsActor,
    id: string,
    storageKey: string,
  ): Promise<AdminNewsDTO> {
    const { news } = await this.load(id);
    const keys = news.galleryKeys.filter((k) => k !== storageKey);
    if (keys.length === news.galleryKeys.length) throw new NotFoundError('Gallery photo not found');

    await this.db.transaction(async (tx) => {
      await this.news.setGalleryKeys(id, keys, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.NEWS_GALLERY_UPDATED,
          entityType: AuditEntityType.NEWS,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { newsId: id, photoCount: keys.length },
          context: actor.context,
        },
        tx,
      );
    });
    await this.sweep(storageKey, id);
    return this.adminDetail(await this.load(id));
  }

  private async presign(input: {
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<UploadUrlResult> {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a news image`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
    const storageKey = buildObjectKey(StoragePrefix.contentFiles, input.filename);
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

  private async assertUploadedObject(input: {
    storageKey: string;
    mimeType: string;
  }): Promise<void> {
    if (!input.storageKey.startsWith(`${StoragePrefix.contentFiles}/`)) {
      throw new BadRequestError('storage key does not belong to content uploads', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
    const head = await this.storage.head(input.storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? input.mimeType;
    if (head.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(realMime as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  }

  private async sweep(key: string, id: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (err) {
      this.log.error({ err, newsId: id }, 'failed to delete replaced news image — needs a sweep');
    }
  }

  // --- management: reads -----------------------------------

  async getAdminNews(id: string): Promise<AdminNewsDTO> {
    return this.adminDetail(await this.load(id));
  }

  async listAdminNews(
    filter: ListAdminNewsFilter,
  ): Promise<{ items: AdminNewsDTO[]; total: number }> {
    const { items, total } = await this.news.listAdmin(filter);
    return { items: await Promise.all(items.map((nw) => this.adminDetail(nw))), total };
  }

  // --- public reads ---------------------------------------

  async listPublicNews(
    viewerUserId: string,
    filter: ListNewsFilter,
  ): Promise<{ items: NewsListItemDTO[]; total: number }> {
    const { items, total } = await this.news.listPublic(filter);
    const bookmarked = await this.bookmarks.bookmarkedSet(
      viewerUserId,
      items.map((nw) => nw.news.id),
    );
    return {
      items: await Promise.all(items.map((nw) => this.listItem(nw, bookmarked.has(nw.news.id)))),
      total,
    };
  }

  async getPublicNews(viewerUserId: string, id: string): Promise<NewsDTO> {
    const nw = await this.loadVisible(id);
    const isBookmarked = await this.bookmarks.isBookmarked(viewerUserId, id);
    return this.detail(nw, isBookmarked);
  }

  async getFeatured(viewerUserId: string): Promise<NewsDTO | null> {
    const nw = await this.news.findFeatured();
    if (!nw) return null;
    const isBookmarked = await this.bookmarks.isBookmarked(viewerUserId, nw.news.id);
    return this.detail(nw, isBookmarked);
  }

  // --- engagement toggle --------------------------------

  async setBookmark(
    userId: string,
    id: string,
    on: boolean,
  ): Promise<{ isBookmarked: boolean; bookmarkCount: number }> {
    await this.loadVisible(id);
    const bookmarkCount = await this.db.transaction(async (tx) => {
      if (on) {
        const inserted = await this.bookmarks.add(userId, id, tx);
        return inserted ? this.news.adjustBookmarkCount(id, 1, tx) : this.currentCount(id, tx);
      }
      const removed = await this.bookmarks.remove(userId, id, tx);
      return removed > 0 ? this.news.adjustBookmarkCount(id, -1, tx) : this.currentCount(id, tx);
    });
    return { isBookmarked: on, bookmarkCount };
  }

  private async currentCount(id: string, tx: Knex.Transaction): Promise<number> {
    const nw = await this.news.findById(id, tx);
    return nw?.news.bookmarkCount ?? 0;
  }
}

interface UploadUrlResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}
