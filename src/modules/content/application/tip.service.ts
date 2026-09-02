import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { ContentPolicy } from '../domain/content.policy.js';
import {
  ALLOWED_COVER_MIME,
  COVER_URL_TTL_SECONDS,
  INTRO_MAX,
  MAX_COVER_BYTES,
  MAX_POINTS,
  POINT_MAX,
  READ_MINUTES_MAX,
  READ_MINUTES_MIN,
  SUMMARY_MAX,
  TITLE_MAX,
  VET_ADVICE_MAX,
  isTipPriority,
  type TipPriority,
} from '../domain/tip.constants.js';
import type {
  AdminTipDTO,
  ListAdminTipsFilter,
  ListTipsFilter,
  TipDTO,
  TipListItemDTO,
} from '../domain/tip.types.js';
import type { CategoryRepository } from '../infrastructure/category.repository.js';
import type { TipEngagementRepository } from '../infrastructure/tip-engagement.repository.js';
import type { TipRepository, TipWithCategory } from '../infrastructure/tip.repository.js';

export interface TipActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateTipInput {
  title: string;
  summary?: string | null;
  readMinutes?: number | null;
  priority?: TipPriority;
  categoryId?: string | null;
  bodyIntro?: string | null;
  keyPoints?: string[];
  warningPoints?: string[];
  vetAdvice?: string | null;
}

export interface UpdateTipInput {
  title?: string;
  summary?: string | null;
  readMinutes?: number | null;
  priority?: TipPriority;
  categoryId?: string | null;
  bodyIntro?: string | null;
  keyPoints?: string[];
  warningPoints?: string[];
  vetAdvice?: string | null;
}

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

function assertReadMinutes(v: number | null | undefined): void {
  if (v == null) return;
  if (!Number.isInteger(v) || v < READ_MINUTES_MIN || v > READ_MINUTES_MAX) {
    throw new BadRequestError(
      `readMinutes must be an integer ${READ_MINUTES_MIN}-${READ_MINUTES_MAX}`,
    );
  }
}

/**
 * "Tips" lifecycle + engagement inside the content module. Authorization for
 * management is the route `authorizeContent('content.*')` middleware (ADMIN
 * override / approved-vet CONTENT supervisor). Public reads require only
 * authentication; only PUBLISHED, not-deleted tips are visible.
 *
 * Storage: presigned direct-to-R2 for the cover image (`StoragePrefix.tipCovers`)
 * — same convention as content files; the DB transaction never wraps a storage
 * call, and a replaced object is swept best-effort after commit.
 */
export class TipService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly tips: TipRepository,
    private readonly engagement: TipEngagementRepository,
    private readonly categories: CategoryRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'tip-service' });
  }

  // --- helpers --------------------------------------------------

  private async load(id: string): Promise<TipWithCategory> {
    const tw = await this.tips.findById(id);
    if (!tw) throw new NotFoundError('Tip not found');
    return tw;
  }

  private async loadVisible(id: string): Promise<TipWithCategory> {
    const tw = await this.load(id);
    if (tw.tip.status !== 'PUBLISHED' || tw.tip.deletedAt) {
      throw new NotFoundError('Tip not found');
    }
    return tw;
  }

  private async assertCategory(id: string | null | undefined): Promise<void> {
    if (!id) return;
    const found = await this.categories.findExistingIds([id]);
    if (!found.has(id)) throw new BadRequestError(`unknown categoryId: ${id}`);
  }

  private validateContent(input: CreateTipInput | UpdateTipInput): void {
    if (input.priority !== undefined && !isTipPriority(input.priority)) {
      throw new BadRequestError('priority must be IMPORTANT, RECOMMENDED or NORMAL');
    }
    assertMaxLen(input.summary, SUMMARY_MAX, 'summary');
    assertMaxLen(input.bodyIntro, INTRO_MAX, 'bodyIntro');
    assertMaxLen(input.vetAdvice, VET_ADVICE_MAX, 'vetAdvice');
    assertReadMinutes(input.readMinutes);
    assertPoints(input.keyPoints, 'keyPoints');
    assertPoints(input.warningPoints, 'warningPoints');
  }

  private resolveCoverUrl(key: string): Promise<string> | string {
    const publicUrl = this.storage.getPublicUrl(key);
    if (publicUrl) return publicUrl;
    return this.storage.getSignedUrl(key, { operation: 'get', expiresIn: COVER_URL_TTL_SECONDS });
  }

  private async listItem(
    tw: TipWithCategory,
    viewer: { isBookmarked: boolean; isHelpful: boolean },
  ): Promise<TipListItemDTO> {
    const { tip, category } = tw;
    return {
      id: tip.id,
      title: tip.title,
      summary: tip.summary,
      readMinutes: tip.readMinutes,
      priority: tip.priority,
      isTipOfDay: tip.isTipOfDay,
      category: category,
      coverImageUrl: tip.coverImageStorageKey
        ? await this.resolveCoverUrl(tip.coverImageStorageKey)
        : null,
      helpfulCount: tip.helpfulCount,
      isBookmarked: viewer.isBookmarked,
      isHelpful: viewer.isHelpful,
      publishedAt: tip.publishedAt,
    };
  }

  private async detail(
    tw: TipWithCategory,
    viewer: { isBookmarked: boolean; isHelpful: boolean },
  ): Promise<TipDTO> {
    const base = await this.listItem(tw, viewer);
    return {
      ...base,
      bodyIntro: tw.tip.bodyIntro,
      keyPoints: tw.tip.keyPoints,
      warningPoints: tw.tip.warningPoints,
      vetAdvice: tw.tip.vetAdvice,
      updatedAt: tw.tip.updatedAt,
    };
  }

  private async adminDetail(tw: TipWithCategory): Promise<AdminTipDTO> {
    const d = await this.detail(tw, { isBookmarked: false, isHelpful: false });
    return {
      ...d,
      status: tw.tip.status,
      createdByUserId: tw.tip.createdByUserId,
      updatedByUserId: tw.tip.updatedByUserId,
      createdAt: tw.tip.createdAt,
    };
  }

  // --- management: create / update ----------------------------

  async createTip(actor: TipActor, input: CreateTipInput): Promise<AdminTipDTO> {
    assertTitle(input.title);
    this.validateContent(input);
    await this.assertCategory(input.categoryId);

    const created = await this.db.transaction(async (tx) => {
      const tip = await this.tips.create(
        {
          categoryId: input.categoryId ?? null,
          title: input.title,
          summary: input.summary ?? null,
          readMinutes: input.readMinutes ?? null,
          priority: input.priority ?? 'NORMAL',
          bodyIntro: input.bodyIntro ?? null,
          keyPoints: input.keyPoints ?? [],
          warningPoints: input.warningPoints ?? [],
          vetAdvice: input.vetAdvice ?? null,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.TIP_CREATED,
          entityType: AuditEntityType.TIP,
          entityId: tip.id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: tip.id },
          context: actor.context,
        },
        tx,
      );
      return tip;
    });

    return this.adminDetail(await this.load(created.id));
  }

  async updateTip(actor: TipActor, id: string, input: UpdateTipInput): Promise<AdminTipDTO> {
    await this.load(id);
    if (input.title !== undefined) assertTitle(input.title);
    this.validateContent(input);
    if (input.categoryId !== undefined) await this.assertCategory(input.categoryId);

    await this.db.transaction(async (tx) => {
      await this.tips.update(
        id,
        {
          categoryId: input.categoryId,
          title: input.title,
          summary: input.summary,
          readMinutes: input.readMinutes,
          priority: input.priority,
          bodyIntro: input.bodyIntro,
          keyPoints: input.keyPoints,
          warningPoints: input.warningPoints,
          vetAdvice: input.vetAdvice,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.TIP_UPDATED,
          entityType: AuditEntityType.TIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: id },
          context: actor.context,
        },
        tx,
      );
    });

    return this.adminDetail(await this.load(id));
  }

  // --- management: lifecycle ---------------------------------

  async publishTip(actor: TipActor, id: string): Promise<AdminTipDTO> {
    const { tip } = await this.load(id);
    const changes = ContentPolicy.assertCanPublish(tip.status);
    if (!changes) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.tips.setStatus(id, 'PUBLISHED', actor.actorUserId, { setPublishedAt: true }, tx);
      await this.audit.record(
        {
          action: AuditAction.TIP_PUBLISHED,
          entityType: AuditEntityType.TIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: id },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async archiveTip(actor: TipActor, id: string): Promise<AdminTipDTO> {
    const { tip } = await this.load(id);
    const changes = ContentPolicy.assertCanArchive(tip.status);
    if (!changes) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.tips.setStatus(id, 'ARCHIVED', actor.actorUserId, { setPublishedAt: false }, tx);
      if (tip.isTipOfDay) await this.tips.clearTipOfDay(id, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.TIP_ARCHIVED,
          entityType: AuditEntityType.TIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: id },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async setDeleted(actor: TipActor, id: string, deleted: boolean): Promise<AdminTipDTO> {
    const { tip } = await this.load(id);
    if ((tip.deletedAt !== null) === deleted) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      await this.tips.setDeleted(id, deleted, actor.actorUserId, tx);
      if (deleted && tip.isTipOfDay) await this.tips.clearTipOfDay(id, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: deleted ? AuditAction.TIP_DELETED : AuditAction.TIP_RESTORED,
          entityType: AuditEntityType.TIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: id },
          context: actor.context,
        },
        tx,
      );
    });
    return this.adminDetail(await this.load(id));
  }

  async setTipOfDay(actor: TipActor, id: string, on: boolean): Promise<AdminTipDTO> {
    const { tip } = await this.load(id);
    if (on && tip.status !== 'PUBLISHED') {
      throw new BadRequestError('only a PUBLISHED tip can be the tip of the day');
    }
    if (tip.isTipOfDay === on) return this.adminDetail(await this.load(id));

    await this.db.transaction(async (tx) => {
      if (on) await this.tips.setTipOfDay(id, actor.actorUserId, tx);
      else await this.tips.clearTipOfDay(id, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: on ? AuditAction.TIP_OF_DAY_SET : AuditAction.TIP_OF_DAY_CLEARED,
          entityType: AuditEntityType.TIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: id },
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
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.load(id);
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_COVER_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_COVER_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_COVER_MIME.includes(input.mimeType as (typeof ALLOWED_COVER_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a tip cover`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const storageKey = buildObjectKey(StoragePrefix.tipCovers, input.filename);
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

  async registerCover(
    actor: TipActor,
    id: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<AdminTipDTO> {
    const { tip } = await this.load(id);
    if (!input.storageKey.startsWith(`${StoragePrefix.tipCovers}/`)) {
      throw new BadRequestError('storage key does not belong to tip covers', {
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
    if (head.size > MAX_COVER_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_COVER_MIME.includes(realMime as (typeof ALLOWED_COVER_MIME)[number])) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const previousKey = tip.coverImageStorageKey;
    await this.db.transaction(async (tx) => {
      await this.tips.setCoverImage(
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
          action: AuditAction.TIP_COVER_UPDATED,
          entityType: AuditEntityType.TIP,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { tipId: id, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
    });

    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error({ err, tipId: id }, 'failed to delete replaced tip cover — needs a sweep');
      }
    }

    return this.adminDetail(await this.load(id));
  }

  // --- management: reads -----------------------------------

  async getAdminTip(id: string): Promise<AdminTipDTO> {
    return this.adminDetail(await this.load(id));
  }

  async listAdminTips(
    filter: ListAdminTipsFilter,
  ): Promise<{ items: AdminTipDTO[]; total: number }> {
    const { items, total } = await this.tips.listAdmin(filter);
    return { items: await Promise.all(items.map((tw) => this.adminDetail(tw))), total };
  }

  // --- public reads ---------------------------------------

  private async viewerFor(
    userId: string,
    tipIds: string[],
  ): Promise<Map<string, { isBookmarked: boolean; isHelpful: boolean }>> {
    const [bookmarked, helpful] = await Promise.all([
      this.engagement.bookmarkedSet(userId, tipIds),
      this.engagement.helpfulSet(userId, tipIds),
    ]);
    const map = new Map<string, { isBookmarked: boolean; isHelpful: boolean }>();
    for (const tid of tipIds) {
      map.set(tid, { isBookmarked: bookmarked.has(tid), isHelpful: helpful.has(tid) });
    }
    return map;
  }

  async listPublicTips(
    viewerUserId: string,
    filter: ListTipsFilter,
  ): Promise<{ items: TipListItemDTO[]; total: number }> {
    const { items, total } = await this.tips.listPublic(filter);
    const viewer = await this.viewerFor(
      viewerUserId,
      items.map((tw) => tw.tip.id),
    );
    return {
      items: await Promise.all(
        items.map((tw) =>
          this.listItem(tw, viewer.get(tw.tip.id) ?? { isBookmarked: false, isHelpful: false }),
        ),
      ),
      total,
    };
  }

  async getPublicTip(viewerUserId: string, id: string): Promise<TipDTO> {
    const tw = await this.loadVisible(id);
    const [isBookmarked, isHelpful] = await Promise.all([
      this.engagement.isBookmarked(viewerUserId, id),
      this.engagement.isHelpful(viewerUserId, id),
    ]);
    return this.detail(tw, { isBookmarked, isHelpful });
  }

  async getTipOfTheDay(viewerUserId: string): Promise<TipDTO | null> {
    const tw = await this.tips.findTipOfDay();
    if (!tw) return null;
    const [isBookmarked, isHelpful] = await Promise.all([
      this.engagement.isBookmarked(viewerUserId, tw.tip.id),
      this.engagement.isHelpful(viewerUserId, tw.tip.id),
    ]);
    return this.detail(tw, { isBookmarked, isHelpful });
  }

  // --- engagement toggles --------------------------------

  async setBookmark(userId: string, id: string, on: boolean): Promise<{ isBookmarked: boolean }> {
    await this.loadVisible(id);
    await this.db.transaction(async (tx) => {
      if (on) await this.engagement.addBookmark(userId, id, tx);
      else await this.engagement.removeBookmark(userId, id, tx);
    });
    return { isBookmarked: on };
  }

  async setHelpful(
    userId: string,
    id: string,
    on: boolean,
  ): Promise<{ isHelpful: boolean; helpfulCount: number }> {
    await this.loadVisible(id);
    const helpfulCount = await this.db.transaction(async (tx) => {
      if (on) {
        const inserted = await this.engagement.addHelpful(userId, id, tx);
        return inserted ? this.tips.adjustHelpfulCount(id, 1, tx) : this.currentCount(id, tx);
      }
      const removed = await this.engagement.removeHelpful(userId, id, tx);
      return removed > 0 ? this.tips.adjustHelpfulCount(id, -1, tx) : this.currentCount(id, tx);
    });
    return { isHelpful: on, helpfulCount };
  }

  private async currentCount(id: string, tx: Knex.Transaction): Promise<number> {
    const tw = await this.tips.findById(id, tx);
    return tw?.tip.helpfulCount ?? 0;
  }
}
