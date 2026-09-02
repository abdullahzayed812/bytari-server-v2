import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  ALLOWED_IMAGE_MIME,
  AD_PLACEMENTS,
  AD_TYPES,
  CTA_LABEL_MAX,
  CTA_URL_MAX,
  IMAGE_URL_TTL_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_SLIDES_PER_TYPE,
  SUBTITLE_MAX,
  TITLE_MAX,
  isAdPlacement,
  isAdType,
  type AdPlacement,
} from '../domain/advertisement.constants.js';
import type {
  AdCampaign,
  AdCampaignDTO,
  AdSlide,
  AdSlideDTO,
  ListCampaignsFilter,
  PublicAdCampaignDTO,
} from '../domain/advertisement.types.js';
import type { AdCampaignRepository } from '../infrastructure/ad-campaign.repository.js';
import type { AdSlideRepository } from '../infrastructure/ad-slide.repository.js';

export interface AdActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface CreateCampaignInput {
  placement: string;
  type: string;
  title: string;
  sortOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface UpdateCampaignInput {
  title?: string;
  sortOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface SlideContentInput {
  title?: string | null;
  subtitle?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  sortOrder?: number;
}

const UPLOAD_URL_TTL_SECONDS = 600;

function hasControlChar(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function assertCampaignTitle(title: string): void {
  if (title.trim().length === 0 || title.length > TITLE_MAX) {
    throw new BadRequestError(`title must be 1-${TITLE_MAX} characters`);
  }
}

function assertSlideText(value: string | null | undefined, max: number, field: string): void {
  if (value == null) return;
  if (value.length > max) throw new BadRequestError(`${field} must be at most ${max} characters`);
  if (hasControlChar(value.replace(/\n/g, ''))) {
    throw new BadRequestError(`${field} contains invalid control characters`);
  }
}

function assertCtaUrl(url: string | null | undefined): void {
  if (url == null || url === '') return;
  if (url.length > CTA_URL_MAX) {
    throw new BadRequestError(`ctaUrl must be at most ${CTA_URL_MAX} characters`);
  }
  // Accept absolute http(s) links and app deep links (`scheme://…` / `/path`).
  const ok = /^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|\/)/i.test(url) && !hasControlChar(url);
  if (!ok) throw new BadRequestError('ctaUrl must be an absolute URL, deep link or "/"-path');
}

/**
 * Advertisement lifecycle — campaigns + ordered slides + slide images.
 * Authorization is the route `authorize('advertisement.manage')` middleware
 * (ADMIN override / ADVERTISEMENT supervisor domain). This service enforces
 * field rules, the BANNER/CAROUSEL slide-count rule, and public visibility
 * (active, in-window, not-deleted, has an imaged slide).
 *
 * Storage: presigned direct-to-R2 upload (`StoragePrefix.advertisements`), same
 * convention as `content` / the former home-ads. DB transactions never wrap a
 * storage call.
 */
export class AdvertisementService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly campaigns: AdCampaignRepository,
    private readonly slides: AdSlideRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'advertisement-service' });
  }

  // --- loaders -------------------------------------------------

  private async loadCampaign(id: string): Promise<AdCampaign> {
    const c = await this.campaigns.findById(id);
    if (!c) throw new NotFoundError('Advertisement campaign not found');
    return c;
  }

  private async loadSlide(campaignId: string, slideId: string): Promise<AdSlide> {
    const s = await this.slides.findById(slideId);
    if (!s || s.campaignId !== campaignId) throw new NotFoundError('Advertisement slide not found');
    return s;
  }

  private resolveImageUrl(key: string): Promise<string> | string {
    const publicUrl = this.storage.getPublicUrl(key);
    if (publicUrl) return publicUrl;
    return this.storage.getSignedUrl(key, { operation: 'get', expiresIn: IMAGE_URL_TTL_SECONDS });
  }

  private async slideDto(slide: AdSlide): Promise<AdSlideDTO> {
    return {
      id: slide.id,
      title: slide.title,
      subtitle: slide.subtitle,
      ctaLabel: slide.ctaLabel,
      ctaUrl: slide.ctaUrl,
      imageUrl: slide.imageStorageKey ? await this.resolveImageUrl(slide.imageStorageKey) : null,
      sortOrder: slide.sortOrder,
    };
  }

  private async campaignDto(campaign: AdCampaign, slides: AdSlide[]): Promise<AdCampaignDTO> {
    return {
      id: campaign.id,
      placement: campaign.placement,
      type: campaign.type,
      title: campaign.title,
      isActive: campaign.isActive,
      sortOrder: campaign.sortOrder,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      slides: await Promise.all(slides.map((s) => this.slideDto(s))),
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  }

  // --- campaign: create / update ------------------------------

  async createCampaign(actor: AdActor, input: CreateCampaignInput): Promise<AdCampaignDTO> {
    if (!isAdPlacement(input.placement)) {
      throw new BadRequestError(`placement must be one of: ${AD_PLACEMENTS.join(', ')}`);
    }
    if (!isAdType(input.type)) {
      throw new BadRequestError(`type must be one of: ${AD_TYPES.join(', ')}`);
    }
    assertCampaignTitle(input.title);

    const created = await this.db.transaction(async (tx) => {
      const c = await this.campaigns.create(
        {
          placement: input.placement as AdPlacement,
          type: input.type as (typeof AD_TYPES)[number],
          title: input.title,
          sortOrder: input.sortOrder ?? 0,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.AD_CAMPAIGN_CREATED,
          entityType: AuditEntityType.AD_CAMPAIGN,
          entityId: c.id,
          actorUserId: actor.actorUserId,
          metadata: { campaignId: c.id, placement: c.placement, type: c.type },
          context: actor.context,
        },
        tx,
      );
      return c;
    });

    return this.campaignDto(created, []);
  }

  async updateCampaign(
    actor: AdActor,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<AdCampaignDTO> {
    await this.loadCampaign(id);
    if (input.title !== undefined) assertCampaignTitle(input.title);

    const updated = await this.db.transaction(async (tx) => {
      const c = await this.campaigns.update(
        id,
        {
          title: input.title,
          sortOrder: input.sortOrder,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.AD_CAMPAIGN_UPDATED,
          entityType: AuditEntityType.AD_CAMPAIGN,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { campaignId: id },
          context: actor.context,
        },
        tx,
      );
      return c;
    });

    return this.campaignDto(updated, await this.slides.listByCampaign(id));
  }

  async setCampaignActive(actor: AdActor, id: string, isActive: boolean): Promise<AdCampaignDTO> {
    const existing = await this.loadCampaign(id);
    const slides = await this.slides.listByCampaign(id);
    if (isActive && !slides.some((s) => s.imageStorageKey)) {
      throw new BadRequestError('cannot activate a campaign with no imaged slide');
    }
    if (existing.isActive === isActive) return this.campaignDto(existing, slides);

    const updated = await this.db.transaction(async (tx) => {
      const c = await this.campaigns.setActive(id, isActive, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: isActive
            ? AuditAction.AD_CAMPAIGN_ACTIVATED
            : AuditAction.AD_CAMPAIGN_DEACTIVATED,
          entityType: AuditEntityType.AD_CAMPAIGN,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { campaignId: id },
          context: actor.context,
        },
        tx,
      );
      return c;
    });

    return this.campaignDto(updated, slides);
  }

  async setCampaignDeleted(actor: AdActor, id: string, deleted: boolean): Promise<AdCampaignDTO> {
    const existing = await this.loadCampaign(id);
    const slides = await this.slides.listByCampaign(id);
    if ((existing.deletedAt !== null) === deleted) return this.campaignDto(existing, slides);

    const updated = await this.db.transaction(async (tx) => {
      const c = await this.campaigns.setDeleted(id, deleted, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: deleted ? AuditAction.AD_CAMPAIGN_DELETED : AuditAction.AD_CAMPAIGN_RESTORED,
          entityType: AuditEntityType.AD_CAMPAIGN,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { campaignId: id },
          context: actor.context,
        },
        tx,
      );
      return c;
    });

    return this.campaignDto(updated, slides);
  }

  // --- campaign: reads ---------------------------------------

  async getAdminCampaign(id: string): Promise<AdCampaignDTO> {
    const c = await this.loadCampaign(id);
    return this.campaignDto(c, await this.slides.listByCampaign(id));
  }

  async listAdminCampaigns(
    filter: ListCampaignsFilter,
  ): Promise<{ items: AdCampaignDTO[]; total: number }> {
    const { items, total } = await this.campaigns.listAdmin(filter);
    const slides = await this.slides.listByCampaigns(items.map((c) => c.id));
    const byCampaign = new Map<string, AdSlide[]>();
    for (const s of slides) {
      const arr = byCampaign.get(s.campaignId) ?? [];
      arr.push(s);
      byCampaign.set(s.campaignId, arr);
    }
    return {
      items: await Promise.all(items.map((c) => this.campaignDto(c, byCampaign.get(c.id) ?? []))),
      total,
    };
  }

  /** The mobile feed: eligible campaigns for one placement, imaged slides only. */
  async listPublic(placement: AdPlacement): Promise<PublicAdCampaignDTO[]> {
    const campaigns = await this.campaigns.listPublic(placement);
    if (campaigns.length === 0) return [];
    const slides = await this.slides.listByCampaigns(campaigns.map((c) => c.id));
    const byCampaign = new Map<string, AdSlide[]>();
    for (const s of slides) {
      if (!s.imageStorageKey) continue;
      const arr = byCampaign.get(s.campaignId) ?? [];
      arr.push(s);
      byCampaign.set(s.campaignId, arr);
    }

    const out: PublicAdCampaignDTO[] = [];
    for (const c of campaigns) {
      let imaged = byCampaign.get(c.id) ?? [];
      if (imaged.length === 0) continue; // nothing renderable
      if (c.type === 'BANNER') imaged = imaged.slice(0, 1);
      out.push({
        id: c.id,
        placement: c.placement,
        type: c.type,
        title: c.title,
        slides: await Promise.all(imaged.map((s) => this.slideDto(s))),
      });
    }
    return out;
  }

  // --- slides ----------------------------------------------

  private assertSlideContent(input: SlideContentInput): void {
    assertSlideText(input.title, TITLE_MAX, 'title');
    assertSlideText(input.subtitle, SUBTITLE_MAX, 'subtitle');
    assertSlideText(input.ctaLabel, CTA_LABEL_MAX, 'ctaLabel');
    assertCtaUrl(input.ctaUrl);
    if (input.ctaUrl && !input.ctaLabel) {
      throw new BadRequestError('ctaLabel is required when ctaUrl is set');
    }
  }

  async addSlide(
    actor: AdActor,
    campaignId: string,
    input: SlideContentInput,
  ): Promise<AdSlideDTO> {
    const campaign = await this.loadCampaign(campaignId);
    if (campaign.deletedAt) throw new BadRequestError('cannot add a slide to a deleted campaign');
    this.assertSlideContent(input);

    const count = await this.slides.countByCampaign(campaignId);
    const max = MAX_SLIDES_PER_TYPE[campaign.type];
    if (count >= max) {
      throw new BadRequestError(
        campaign.type === 'BANNER'
          ? 'a BANNER campaign already has its one slide'
          : `a CAROUSEL campaign is capped at ${max} slides`,
      );
    }

    const nextOrder = input.sortOrder ?? (await this.slides.maxSortOrder(campaignId)) + 1;

    const created = await this.db.transaction(async (tx) => {
      const s = await this.slides.create(
        {
          campaignId,
          title: input.title ?? null,
          subtitle: input.subtitle ?? null,
          ctaLabel: input.ctaLabel ?? null,
          ctaUrl: input.ctaUrl ?? null,
          sortOrder: nextOrder,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.AD_SLIDE_ADDED,
          entityType: AuditEntityType.AD_SLIDE,
          entityId: s.id,
          actorUserId: actor.actorUserId,
          metadata: { campaignId, slideId: s.id },
          context: actor.context,
        },
        tx,
      );
      return s;
    });

    return this.slideDto(created);
  }

  async updateSlide(
    actor: AdActor,
    campaignId: string,
    slideId: string,
    input: SlideContentInput,
  ): Promise<AdSlideDTO> {
    const existing = await this.loadSlide(campaignId, slideId);
    this.assertSlideContent({
      title: input.title ?? existing.title,
      subtitle: input.subtitle ?? existing.subtitle,
      ctaLabel: input.ctaLabel === undefined ? existing.ctaLabel : input.ctaLabel,
      ctaUrl: input.ctaUrl === undefined ? existing.ctaUrl : input.ctaUrl,
    });

    const updated = await this.db.transaction(async (tx) => {
      const s = await this.slides.update(
        slideId,
        {
          title: input.title,
          subtitle: input.subtitle,
          ctaLabel: input.ctaLabel,
          ctaUrl: input.ctaUrl,
          sortOrder: input.sortOrder,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.AD_SLIDE_UPDATED,
          entityType: AuditEntityType.AD_SLIDE,
          entityId: slideId,
          actorUserId: actor.actorUserId,
          metadata: { campaignId, slideId },
          context: actor.context,
        },
        tx,
      );
      return s;
    });

    return this.slideDto(updated);
  }

  async deleteSlide(actor: AdActor, campaignId: string, slideId: string): Promise<void> {
    const slide = await this.loadSlide(campaignId, slideId);

    await this.db.transaction(async (tx) => {
      await this.slides.delete(slideId, tx);
      await this.audit.record(
        {
          action: AuditAction.AD_SLIDE_REMOVED,
          entityType: AuditEntityType.AD_SLIDE,
          entityId: slideId,
          actorUserId: actor.actorUserId,
          metadata: { campaignId, slideId },
          context: actor.context,
        },
        tx,
      );
    });

    if (slide.imageStorageKey) {
      try {
        await this.storage.delete(slide.imageStorageKey);
      } catch (err) {
        this.log.error({ err, slideId }, 'failed to delete slide image — needs a sweep');
      }
    }
  }

  async reorderSlides(
    actor: AdActor,
    campaignId: string,
    orderedIds: string[],
  ): Promise<AdCampaignDTO> {
    await this.loadCampaign(campaignId);
    const current = await this.slides.listByCampaign(campaignId);
    const currentIds = new Set(current.map((s) => s.id));
    if (
      orderedIds.length !== current.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !currentIds.has(id))
    ) {
      throw new BadRequestError('slideIds must be a permutation of this campaign’s slides');
    }

    await this.db.transaction(async (tx) => {
      await this.slides.reorder(campaignId, orderedIds, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.AD_SLIDE_REORDERED,
          entityType: AuditEntityType.AD_CAMPAIGN,
          entityId: campaignId,
          actorUserId: actor.actorUserId,
          metadata: { campaignId, order: orderedIds },
          context: actor.context,
        },
        tx,
      );
    });

    const c = await this.loadCampaign(campaignId);
    return this.campaignDto(c, await this.slides.listByCampaign(campaignId));
  }

  // --- slide image (presigned R2, same convention as `content`) ----

  async requestSlideUploadUrl(
    campaignId: string,
    slideId: string,
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    await this.loadSlide(campaignId, slideId);
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for an ad image`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const storageKey = buildObjectKey(StoragePrefix.advertisements, input.filename);
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

  async registerSlideImage(
    actor: AdActor,
    campaignId: string,
    slideId: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<AdSlideDTO> {
    const existing = await this.loadSlide(campaignId, slideId);
    if (!input.storageKey.startsWith(`${StoragePrefix.advertisements}/`)) {
      throw new BadRequestError('storage key does not belong to advertisement images', {
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

    const previousKey = existing.imageStorageKey;
    const updated = await this.db.transaction(async (tx) => {
      const s = await this.slides.setImage(
        slideId,
        {
          imageStorageKey: input.storageKey,
          imageStorageProvider: this.storage.name,
          updatedByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.AD_SLIDE_IMAGE_UPDATED,
          entityType: AuditEntityType.AD_SLIDE,
          entityId: slideId,
          actorUserId: actor.actorUserId,
          metadata: { campaignId, slideId, sizeBytes: head.size },
          context: actor.context,
        },
        tx,
      );
      return s;
    });

    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error({ err, slideId }, 'failed to delete replaced ad image — needs a sweep');
      }
    }

    return this.slideDto(updated);
  }
}
