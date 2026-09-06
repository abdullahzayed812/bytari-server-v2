import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { MarketPolicy } from '../domain/market.policy.js';
import { MAX_POULTRY_OFFER_IMAGES } from '../domain/poultry-offer.constants.js';
import {
  toPoultryOfferDTO,
  type CreatePoultryOfferInput,
  type ListPoultryOffersFilter,
  type PoultryOfferDTO,
} from '../domain/poultry-offer.types.js';
import type { PoultryOfferRepository } from '../infrastructure/poultry-offer.repository.js';

export interface MarketActor {
  actorUserId: string;
  context?: AuditContext;
}

const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_UPLOAD_URL_TTL_SECONDS = 600;
const IMAGE_URL_TTL_SECONDS = 3600;

/**
 * Poultry (live bird) market offer CRUD. Auto-published (`ACTIVE`) on create
 * for an approved trader — the route guard (`requireApprovedTrader()`) is the
 * sole enforcement point, mirroring how `ProductController` relies on
 * `authorizeOrg` rather than re-deriving the same check in the service.
 */
export class PoultryOfferService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly offers: PoultryOfferRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'poultry-offer-service' });
  }

  private async resolveImageUrls(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const urls = await Promise.all(
      keys.map(
        async (key) =>
          this.storage.getPublicUrl(key) ??
          (await this.storage.getSignedUrl(key, {
            operation: 'get',
            expiresIn: IMAGE_URL_TTL_SECONDS,
          })),
      ),
    );
    return urls.filter((u): u is string => u !== null);
  }

  async requestUploadUrl(
    input: { filename: string; mimeType: string; size: number },
  ): Promise<{
    storageKey: string;
    uploadUrl: string;
    method: 'PUT';
    headers: Record<string, string>;
    expiresInSeconds: number;
  }> {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_IMAGE_BYTES) {
      throw new BadRequestError(`photo exceeds the ${MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as (typeof ALLOWED_IMAGE_MIME)[number])) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed for a photo`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }

    const storageKey = buildObjectKey(StoragePrefix.poultryOfferImages, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: IMAGE_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: IMAGE_UPLOAD_URL_TTL_SECONDS,
    };
  }

  async create(input: CreatePoultryOfferInput, actor: MarketActor): Promise<PoultryOfferDTO> {
    const galleryKeys = input.galleryKeys ?? [];
    MarketPolicy.assertGalleryLimit(galleryKeys, MAX_POULTRY_OFFER_IMAGES);

    // Storage I/O ALWAYS happens before the transaction opens.
    for (const key of galleryKeys) {
      if (!key.startsWith(`${StoragePrefix.poultryOfferImages}/`)) {
        throw new ConflictError('storage key does not belong to a poultry offer upload', {
          code: ErrorCode.STORAGE_KEY_MISMATCH,
        });
      }
      const head = await this.storage.head(key);
      if (!head) {
        throw new BadRequestError('no uploaded object exists at that storage key', {
          code: ErrorCode.STORAGE_OBJECT_MISSING,
        });
      }
    }

    const offer = await this.db.transaction(async (tx) => {
      const created = await this.offers.create(actor.actorUserId, input, tx);
      await this.audit.record(
        {
          action: AuditAction.POULTRY_OFFER_CREATED,
          entityType: AuditEntityType.POULTRY_OFFER,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { offerId: created.id, birdType: created.birdType },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('poultry-offer.created', { offerId: offer.id });
    return toPoultryOfferDTO(offer, await this.resolveImageUrls(offer.galleryKeys));
  }

  async get(offerId: string): Promise<PoultryOfferDTO> {
    const offer = await this.offers.findById(offerId);
    if (!offer) throw new NotFoundError('Offer not found');
    return toPoultryOfferDTO(offer, await this.resolveImageUrls(offer.galleryKeys));
  }

  async list(filter: ListPoultryOffersFilter): Promise<{ items: PoultryOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.list(filter);
    const dtos = await Promise.all(
      items.map(async (o) => toPoultryOfferDTO(o, await this.resolveImageUrls(o.galleryKeys))),
    );
    return { items: dtos, total };
  }

  async listMine(
    traderUserId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: PoultryOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.listMine(traderUserId, page, pageSize);
    const dtos = await Promise.all(
      items.map(async (o) => toPoultryOfferDTO(o, await this.resolveImageUrls(o.galleryKeys))),
    );
    return { items: dtos, total };
  }

  /** Owner-or-admin delete (route resolves ownership via `withPoultryOffer` + an inline check). */
  async remove(offerId: string, actor: MarketActor): Promise<void> {
    const offer = await this.offers.findById(offerId);
    if (!offer) throw new NotFoundError('Offer not found');
    if (offer.status === 'REMOVED') return;

    await this.db.transaction(async (tx) => {
      await this.offers.setStatus(offerId, 'REMOVED', tx);
      await this.audit.record(
        {
          action: AuditAction.POULTRY_OFFER_REMOVED,
          entityType: AuditEntityType.POULTRY_OFFER,
          entityId: offerId,
          actorUserId: actor.actorUserId,
          metadata: { offerId },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('poultry-offer.removed', { offerId });
  }

  async adminList(
    filter: ListPoultryOffersFilter,
  ): Promise<{ items: PoultryOfferDTO[]; total: number }> {
    const { items, total } = await this.offers.listAdmin(filter);
    const dtos = await Promise.all(
      items.map(async (o) => toPoultryOfferDTO(o, await this.resolveImageUrls(o.galleryKeys))),
    );
    return { items: dtos, total };
  }
}
