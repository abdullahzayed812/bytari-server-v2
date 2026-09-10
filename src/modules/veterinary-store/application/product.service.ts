import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import { StoragePrefix, buildObjectKey } from '../../../infra/storage/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import {
  ALLOWED_PRODUCT_IMAGE_MIME,
  MAX_PRODUCT_IMAGES,
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
} from '../domain/store.constants.js';
import { StorePolicy } from '../domain/store.policy.js';
import type {
  CreateProductInput,
  ListProductsFilter,
  Product,
  ProductDTO,
  UpdateProductInput,
} from '../domain/store.types.js';
import type { ProductRepository } from '../infrastructure/product.repository.js';
import { resolveVetStoreImageUrlOrNull } from './product-media.js';

export interface StoreActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface OrgRef {
  id: string;
  type: string;
}

export interface ProductImageUploadUrlInput {
  filename: string;
  mimeType: string;
  size: number;
}

export interface ProductImageUploadUrlResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Product lifecycle for organizations that can own products — a
 * VETERINARY_STORE or a VETERINARY_OFFICE (`StorePolicy.assertProductCapable`).
 * Every product belongs to exactly one such organization (DB composite FK to
 * `organizations(id, type)`), and every lookup is `organization_id`-scoped so
 * a member of Store/Office A can never touch Store/Office B's products. Stock
 * is only changed through {@link adjustStock}.
 *
 * `listPublic` / `getPublic` back the Veterinary Offices product-browsing
 * screens — any authenticated user, not just members — mirroring
 * `OrganizationService.discoverPublic` / `getPublicById`: ACTIVE organization,
 * ACTIVE products only.
 */
export class ProductService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly products: ProductRepository,
    private readonly organizations: OrganizationRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'product-service' });
  }

  async create(org: OrgRef, input: CreateProductInput, actor: StoreActor): Promise<ProductDTO> {
    StorePolicy.assertProductCapable(org);

    const product = await this.db.transaction(async (tx) => {
      const created = await this.products.create(
        {
          organizationId: org.id,
          organizationType: org.type,
          name: input.name,
          description: input.description ?? null,
          productType: input.productType,
          price: input.price ?? null,
          stockQuantity: input.stockQuantity ?? 0,
          subtype: input.subtype ?? null,
          weight: input.weight ?? null,
          usageInstructions: input.usageInstructions ?? null,
          dosage: input.dosage ?? null,
          shelfLife: input.shelfLife ?? null,
          manufacturer: input.manufacturer ?? null,
          highlights: input.highlights ?? [],
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_CREATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: org.id, productId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('product.created', { productId: product.id, organizationId: org.id });
    return this.toDTO(product);
  }

  async get(organizationId: string, productId: string): Promise<ProductDTO> {
    const product = await this.products.findByIdForOrganization(productId, organizationId);
    if (!product) throw new NotFoundError('Product not found');
    return this.toDTO(product);
  }

  async list(
    organizationId: string,
    filter: ListProductsFilter,
  ): Promise<{ items: ProductDTO[]; total: number }> {
    const { items, total } = await this.products.listForOrganization(organizationId, filter);
    return { items: await Promise.all(items.map((p) => this.toDTO(p))), total };
  }

  /**
   * Public catalog browse — any authenticated user. ACTIVE organization +
   * ACTIVE products only; `filter.status` is ignored (always forced ACTIVE).
   */
  async listPublic(
    organizationId: string,
    filter: Omit<ListProductsFilter, 'status'>,
  ): Promise<{ items: ProductDTO[]; total: number }> {
    await this.assertPubliclyBrowsable(organizationId);
    const { items, total } = await this.products.listForOrganization(organizationId, {
      ...filter,
      status: 'ACTIVE',
    });
    return { items: await Promise.all(items.map((p) => this.toDTO(p))), total };
  }

  /** Public single-product counterpart of {@link listPublic}. */
  async getPublic(organizationId: string, productId: string): Promise<ProductDTO> {
    await this.assertPubliclyBrowsable(organizationId);
    const product = await this.products.findByIdForOrganization(productId, organizationId);
    if (!product || product.status !== 'ACTIVE') throw new NotFoundError('Product not found');
    return this.toDTO(product);
  }

  /**
   * A non-existent org, an inactive one, and a product-incapable type (e.g. a
   * CLINIC) all read the same to a stranger browsing the public catalog: 404,
   * never a 400 — this is a visibility check, not request validation.
   */
  private async assertPubliclyBrowsable(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Organization not found');
    try {
      StorePolicy.assertProductCapable(org);
    } catch {
      throw new NotFoundError('Organization not found');
    }
  }

  async update(
    organizationId: string,
    productId: string,
    patch: UpdateProductInput,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const existing = await this.products.findByIdForOrganization(productId, organizationId);
    if (!existing) throw new NotFoundError('Product not found');

    const updated = await this.db.transaction(async (tx) => {
      const product = await this.products.update(productId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_UPDATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, productId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('product.updated', { productId, organizationId });
    return this.toDTO(updated);
  }

  /** Soft-delete: `status = INACTIVE`. Idempotent. Product history is preserved. */
  async deactivate(
    organizationId: string,
    productId: string,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const existing = await this.products.findByIdForOrganization(productId, organizationId);
    if (!existing) throw new NotFoundError('Product not found');
    if (existing.status === 'INACTIVE') return this.toDTO(existing);

    const updated = await this.db.transaction(async (tx) => {
      const product = await this.products.update(productId, { status: 'INACTIVE' }, tx);
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_DEACTIVATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, productId },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('product.deactivated', { productId, organizationId });
    return this.toDTO(updated);
  }

  /** Controlled stock movement. `delta` is signed; the result may not go negative. */
  async adjustStock(
    organizationId: string,
    productId: string,
    delta: number,
    reason: string | null,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const existing = await this.products.findByIdForOrganization(productId, organizationId);
    if (!existing) throw new NotFoundError('Product not found');

    const nextQuantity = StorePolicy.applyStockDelta(existing.stockQuantity, delta);

    const updated = await this.db.transaction(async (tx) => {
      const product = await this.products.setStock(productId, nextQuantity, tx);
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_INVENTORY_ADJUSTED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            productId,
            delta,
            previousQuantity: existing.stockQuantity,
            newQuantity: nextQuantity,
            reason,
          },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('inventory.adjusted', { productId, organizationId });
    return this.toDTO(updated);
  }

  // --- images -------------------------------------------------------

  async requestImageUploadUrl(
    organizationId: string,
    productId: string,
    input: ProductImageUploadUrlInput,
  ): Promise<ProductImageUploadUrlResult> {
    const product = await this.products.findByIdForOrganization(productId, organizationId);
    if (!product) throw new NotFoundError('Product not found');
    this.assertUploadInput(input);

    const existing = await this.products.listImages(productId);
    if (existing.length >= MAX_PRODUCT_IMAGES) {
      throw new ConflictError(`a product may have at most ${MAX_PRODUCT_IMAGES} images`, {
        code: ErrorCode.CONFLICT,
      });
    }

    const storageKey = buildObjectKey(StoragePrefix.veterinaryStoreProductImages, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
    };
  }

  async addImage(
    organizationId: string,
    productId: string,
    actor: StoreActor,
    input: { storageKey: string; mimeType: string },
  ): Promise<ProductDTO> {
    const product = await this.products.findByIdForOrganization(productId, organizationId);
    if (!product) throw new NotFoundError('Product not found');
    await this.assertUploadedObject(input.storageKey, input.mimeType);

    const updated = await this.db.transaction(async (tx) => {
      const sortOrder = await this.products.nextImageSortOrder(productId, tx);
      await this.products.addImage(productId, input.storageKey, sortOrder, tx);
      let result = product;
      if (!product.primaryImageKey) {
        result = await this.products.update(
          productId,
          { primaryImageKey: input.storageKey },
          tx,
        );
      }
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_IMAGE_UPDATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, productId, storageKey: input.storageKey, op: 'added' },
          context: actor.context,
        },
        tx,
      );
      return result;
    });

    return this.toDTO(updated);
  }

  async removeImage(
    organizationId: string,
    productId: string,
    imageId: string,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const product = await this.products.findByIdForOrganization(productId, organizationId);
    if (!product) throw new NotFoundError('Product not found');
    const image = await this.products.findImage(productId, imageId);
    if (!image) throw new NotFoundError('Image not found');

    const updated = await this.db.transaction(async (tx) => {
      await this.products.deleteImage(imageId, tx);
      let result = product;
      if (product.primaryImageKey === image.image_key) {
        const remaining = await this.products.listImages(productId, tx);
        result = await this.products.update(
          productId,
          { primaryImageKey: remaining[0]?.image_key ?? null },
          tx,
        );
      }
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_IMAGE_UPDATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, productId, imageId, op: 'removed' },
          context: actor.context,
        },
        tx,
      );
      return result;
    });

    return this.toDTO(updated);
  }

  private assertUploadInput(input: ProductImageUploadUrlInput): void {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > MAX_PRODUCT_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${MAX_PRODUCT_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(ALLOWED_PRODUCT_IMAGE_MIME as readonly string[]).includes(input.mimeType)) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  }

  private async assertUploadedObject(storageKey: string, mimeType: string): Promise<void> {
    if (!storageKey.startsWith(`${StoragePrefix.veterinaryStoreProductImages}/`)) {
      throw new ConflictError('storage key does not belong to product uploads', {
        code: ErrorCode.STORAGE_KEY_MISMATCH,
      });
    }
    const head = await this.storage.head(storageKey);
    if (!head) {
      throw new BadRequestError('no uploaded object exists at that storage key', {
        code: ErrorCode.STORAGE_OBJECT_MISSING,
      });
    }
    const realMime = head.contentType ?? mimeType;
    if (head.size > MAX_PRODUCT_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(ALLOWED_PRODUCT_IMAGE_MIME as readonly string[]).includes(realMime)) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  }

  private async toDTO(p: Product): Promise<ProductDTO> {
    const imageRows = await this.products.listImages(p.id);
    const images = await Promise.all(
      imageRows.map(async (img) => ({
        id: img.id,
        url: (await resolveVetStoreImageUrlOrNull(this.storage, img.image_key)) ?? '',
        sortOrder: img.sort_order,
      })),
    );
    return {
      id: p.id,
      organizationId: p.organizationId,
      organizationType: p.organizationType,
      name: p.name,
      description: p.description,
      productType: p.productType,
      price: p.price,
      stockQuantity: p.stockQuantity,
      status: p.status,
      subtype: p.subtype,
      weight: p.weight,
      usageInstructions: p.usageInstructions,
      dosage: p.dosage,
      shelfLife: p.shelfLife,
      manufacturer: p.manufacturer,
      highlights: p.highlights,
      primaryImageUrl: await resolveVetStoreImageUrlOrNull(this.storage, p.primaryImageKey),
      images: images.filter((i) => i.url),
      createdByUserId: p.createdByUserId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
