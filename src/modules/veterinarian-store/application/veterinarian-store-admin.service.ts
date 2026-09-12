import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { EventBus } from '../../../shared/events/index.js';
import { buildObjectKey, StoragePrefix, type ObjectStorage } from '../../../infra/storage/index.js';
import { AuditAction, AuditEntityType } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import {
  VETERINARIAN_STORE_ALLOWED_IMAGE_MIME,
  VETERINARIAN_STORE_MAX_IMAGE_BYTES,
  VETERINARIAN_STORE_MAX_PRODUCT_IMAGES,
  VETERINARIAN_STORE_UPLOAD_URL_TTL_SECONDS,
} from '../domain/veterinarian-store.constants.js';
import type {
  CreateVeterinarianStoreCategoryInput,
  CreateVeterinarianStoreProductInput,
  ListVeterinarianStoreProductsFilter,
  VeterinarianStoreAdminProductDTO,
  VeterinarianStoreCategoryDTO,
  UpdateVeterinarianStoreCategoryInput,
  UpdateVeterinarianStoreProductInput,
} from '../domain/veterinarian-store.types.js';
import type { VeterinarianStoreCategoryRepository } from '../infrastructure/category.repository.js';
import type {
  VeterinarianStoreProductRepository,
  VeterinarianStoreProductWithCategory,
} from '../infrastructure/product.repository.js';
import { resolveVeterinarianStoreImageUrlOrNull } from './veterinarian-store-media.js';
import type { VeterinarianStoreActor } from './veterinarian-store-order.service.js';

export interface UploadUrlInput {
  filename: string;
  mimeType: string;
  size: number;
}

export interface UploadUrlResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Catalogue management for the Veterinarian Store — products, categories, product
 * images. Every route that reaches this is gated by `authorize('veterinarian_store.*')`
 * (ADMIN override or an ACTIVE VETERINARIAN_STORE system-supervisor). Product
 * images go through the shared presigned-direct-to-R2 seam; storage
 * credentials never reach the client.
 */
export class VeterinarianStoreAdminService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly products: VeterinarianStoreProductRepository,
    private readonly categories: VeterinarianStoreCategoryRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-store-admin-service' });
  }

  // =================================================================
  // Products
  // =================================================================

  async listProducts(
    filter: ListVeterinarianStoreProductsFilter,
  ): Promise<{ items: VeterinarianStoreAdminProductDTO[]; total: number }> {
    const { items, total } = await this.products.list(filter);
    return { items: await Promise.all(items.map((pc) => this.toAdminDTO(pc))), total };
  }

  async getProduct(id: string): Promise<VeterinarianStoreAdminProductDTO> {
    const found = await this.products.findWithCategory(id);
    if (!found) throw new NotFoundError('Product not found');
    return this.toAdminDTO(found);
  }

  async createProduct(
    actor: VeterinarianStoreActor,
    input: CreateVeterinarianStoreProductInput,
  ): Promise<VeterinarianStoreAdminProductDTO> {
    await this.assertCategory(input.categoryId ?? null);

    const created = await this.db.transaction(async (tx) => {
      const product = await this.products.create(
        {
          categoryId: input.categoryId ?? null,
          name: input.name,
          description: input.description ?? null,
          price: input.price,
          stockQuantity: input.stockQuantity ?? 0,
          attributes: input.attributes ?? null,
          status: input.status ?? 'ACTIVE',
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_PRODUCT_CREATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_PRODUCT,
          entityId: product.id,
          actorUserId: actor.actorUserId,
          metadata: { productId: product.id },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('veterinarian_store.product.created', { productId: created.id });
    return this.getProduct(created.id);
  }

  async updateProduct(
    actor: VeterinarianStoreActor,
    id: string,
    patch: UpdateVeterinarianStoreProductInput,
  ): Promise<VeterinarianStoreAdminProductDTO> {
    const existing = await this.products.findById(id);
    if (!existing) throw new NotFoundError('Product not found');
    if (patch.categoryId !== undefined) await this.assertCategory(patch.categoryId);

    await this.db.transaction(async (tx) => {
      await this.products.update(id, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_PRODUCT_UPDATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_PRODUCT,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { productId: id, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('veterinarian_store.product.updated', { productId: id });
    return this.getProduct(id);
  }

  /** Soft-delete: `status = INACTIVE`. Idempotent. History (orders) is preserved. */
  async deactivateProduct(actor: VeterinarianStoreActor, id: string): Promise<VeterinarianStoreAdminProductDTO> {
    const existing = await this.products.findById(id);
    if (!existing) throw new NotFoundError('Product not found');
    if (existing.status === 'INACTIVE') return this.getProduct(id);

    await this.db.transaction(async (tx) => {
      await this.products.update(id, { status: 'INACTIVE' }, tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_PRODUCT_DEACTIVATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_PRODUCT,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { productId: id },
          context: actor.context,
        },
        tx,
      );
    });

    this.events.publish('veterinarian_store.product.deactivated', { productId: id });
    return this.getProduct(id);
  }

  // --- product images -------------------------------------------

  async requestProductImageUploadUrl(
    productId: string,
    input: UploadUrlInput,
  ): Promise<UploadUrlResult> {
    const product = await this.products.findById(productId);
    if (!product) throw new NotFoundError('Product not found');
    this.assertUploadInput(input);
    const existing = await this.products.listImages(productId);
    if (existing.length >= VETERINARIAN_STORE_MAX_PRODUCT_IMAGES) {
      throw new ConflictError(`a product may have at most ${VETERINARIAN_STORE_MAX_PRODUCT_IMAGES} images`, {
        code: ErrorCode.CONFLICT,
      });
    }
    return this.buildUploadUrl(StoragePrefix.veterinarianStoreProducts, input);
  }

  async registerProductImage(
    actor: VeterinarianStoreActor,
    productId: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<VeterinarianStoreAdminProductDTO> {
    const product = await this.products.findById(productId);
    if (!product) throw new NotFoundError('Product not found');
    await this.assertUploadedObject(
      input.storageKey,
      input.mimeType,
      StoragePrefix.veterinarianStoreProducts,
    );

    await this.db.transaction(async (tx) => {
      const sortOrder = await this.products.nextImageSortOrder(productId, tx);
      await this.products.addImage(productId, input.storageKey, sortOrder, tx);
      if (!product.primaryImageKey) {
        await this.products.update(productId, { primaryImageKey: input.storageKey }, tx);
      }
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_PRODUCT_IMAGE_UPDATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { productId, storageKey: input.storageKey, op: 'added' },
          context: actor.context,
        },
        tx,
      );
    });

    return this.getProduct(productId);
  }

  async removeProductImage(
    actor: VeterinarianStoreActor,
    productId: string,
    imageId: string,
  ): Promise<VeterinarianStoreAdminProductDTO> {
    const product = await this.products.findById(productId);
    if (!product) throw new NotFoundError('Product not found');
    const image = await this.products.findImage(productId, imageId);
    if (!image) throw new NotFoundError('Image not found');

    await this.db.transaction(async (tx) => {
      await this.products.deleteImage(imageId, tx);
      if (product.primaryImageKey === image.image_key) {
        const remaining = await this.products.listImages(productId, tx);
        await this.products.update(
          productId,
          { primaryImageKey: remaining[0]?.image_key ?? null },
          tx,
        );
      }
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_PRODUCT_IMAGE_UPDATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { productId, imageId, op: 'removed' },
          context: actor.context,
        },
        tx,
      );
    });

    try {
      await this.storage.delete(image.image_key);
    } catch (err) {
      this.log.error(
        { err, productId, imageId },
        'failed to delete removed product image — needs a sweep',
      );
    }

    return this.getProduct(productId);
  }

  // =================================================================
  // Categories
  // =================================================================

  async listCategories(): Promise<VeterinarianStoreCategoryDTO[]> {
    const [rows, counts] = await Promise.all([
      this.categories.list({ activeOnly: false }),
      this.categories.productCounts(),
    ]);
    return Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        imageUrl: await resolveVeterinarianStoreImageUrlOrNull(this.storage, c.imageKey),
        showOnHome: c.showOnHome,
        sortOrder: c.sortOrder,
        status: c.status,
        productCount: counts.get(c.id) ?? 0,
      })),
    );
  }

  async createCategory(
    actor: VeterinarianStoreActor,
    input: CreateVeterinarianStoreCategoryInput,
  ): Promise<VeterinarianStoreCategoryDTO> {
    if (await this.categories.findBySlug(input.slug)) {
      throw new ConflictError(`a category with slug "${input.slug}" already exists`, {
        code: ErrorCode.CONFLICT,
      });
    }
    const created = await this.db.transaction(async (tx) => {
      const category = await this.categories.create(
        {
          slug: input.slug,
          name: input.name,
          showOnHome: input.showOnHome ?? false,
          sortOrder: input.sortOrder ?? 0,
          status: input.status ?? 'ACTIVE',
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_CATEGORY_CREATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_CATEGORY,
          entityId: category.id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: category.id, slug: category.slug },
          context: actor.context,
        },
        tx,
      );
      return category;
    });
    return this.categoryDTO(created.id);
  }

  async updateCategory(
    actor: VeterinarianStoreActor,
    id: string,
    patch: UpdateVeterinarianStoreCategoryInput,
  ): Promise<VeterinarianStoreCategoryDTO> {
    const existing = await this.categories.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    if (patch.slug && patch.slug !== existing.slug) {
      const clash = await this.categories.findBySlug(patch.slug);
      if (clash) {
        throw new ConflictError(`a category with slug "${patch.slug}" already exists`, {
          code: ErrorCode.CONFLICT,
        });
      }
    }
    await this.db.transaction(async (tx) => {
      await this.categories.update(id, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_CATEGORY_UPDATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_CATEGORY,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: id, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
    });
    return this.categoryDTO(id);
  }

  async deleteCategory(actor: VeterinarianStoreActor, id: string): Promise<void> {
    const existing = await this.categories.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    await this.db.transaction(async (tx) => {
      // Products keep existing; their `category_id` is nulled by the FK
      // (`ON DELETE SET NULL`).
      await this.categories.delete(id, tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_CATEGORY_DELETED,
          entityType: AuditEntityType.VETERINARIAN_STORE_CATEGORY,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: id, slug: existing.slug },
          context: actor.context,
        },
        tx,
      );
    });
  }

  async requestCategoryImageUploadUrl(id: string, input: UploadUrlInput): Promise<UploadUrlResult> {
    const existing = await this.categories.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    this.assertUploadInput(input);
    return this.buildUploadUrl(StoragePrefix.veterinarianStoreCategories, input);
  }

  async registerCategoryImage(
    actor: VeterinarianStoreActor,
    id: string,
    input: { storageKey: string; mimeType: string },
  ): Promise<VeterinarianStoreCategoryDTO> {
    const existing = await this.categories.findById(id);
    if (!existing) throw new NotFoundError('Category not found');
    await this.assertUploadedObject(
      input.storageKey,
      input.mimeType,
      StoragePrefix.veterinarianStoreCategories,
    );
    const previousKey = existing.imageKey;
    await this.db.transaction(async (tx) => {
      await this.categories.update(id, { imageKey: input.storageKey }, tx);
      await this.audit.record(
        {
          action: AuditAction.VETERINARIAN_STORE_CATEGORY_UPDATED,
          entityType: AuditEntityType.VETERINARIAN_STORE_CATEGORY,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: id, fields: ['imageKey'] },
          context: actor.context,
        },
        tx,
      );
    });
    if (previousKey && previousKey !== input.storageKey) {
      try {
        await this.storage.delete(previousKey);
      } catch (err) {
        this.log.error(
          { err, categoryId: id },
          'failed to delete replaced category image — needs a sweep',
        );
      }
    }
    return this.categoryDTO(id);
  }

  // =================================================================
  // Helpers
  // =================================================================

  private async assertCategory(id: string | null): Promise<void> {
    if (!id) return;
    const found = await this.categories.findById(id);
    if (!found) throw new BadRequestError(`unknown categoryId: ${id}`);
  }

  private assertUploadInput(input: UploadUrlInput): void {
    if (!Number.isInteger(input.size) || input.size <= 0) {
      throw new BadRequestError('size must be a positive integer number of bytes');
    }
    if (input.size > VETERINARIAN_STORE_MAX_IMAGE_BYTES) {
      throw new BadRequestError(`image exceeds the ${VETERINARIAN_STORE_MAX_IMAGE_BYTES}-byte limit`, {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(VETERINARIAN_STORE_ALLOWED_IMAGE_MIME as readonly string[]).includes(input.mimeType)) {
      throw new BadRequestError(`MIME type "${input.mimeType}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  }

  private async buildUploadUrl(prefix: string, input: UploadUrlInput): Promise<UploadUrlResult> {
    const storageKey = buildObjectKey(prefix, input.filename);
    const uploadUrl = await this.storage.getSignedUrl(storageKey, {
      operation: 'put',
      expiresIn: VETERINARIAN_STORE_UPLOAD_URL_TTL_SECONDS,
      contentType: input.mimeType,
    });
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresInSeconds: VETERINARIAN_STORE_UPLOAD_URL_TTL_SECONDS,
    };
  }

  private async assertUploadedObject(
    storageKey: string,
    mimeType: string,
    prefix: string,
  ): Promise<void> {
    if (!storageKey.startsWith(`${prefix}/`)) {
      throw new BadRequestError('storage key does not belong to the veterinarian store', {
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
    if (head.size > VETERINARIAN_STORE_MAX_IMAGE_BYTES) {
      throw new BadRequestError('the uploaded object exceeds the size limit', {
        code: ErrorCode.FILE_TOO_LARGE,
      });
    }
    if (!(VETERINARIAN_STORE_ALLOWED_IMAGE_MIME as readonly string[]).includes(realMime)) {
      throw new BadRequestError(`the uploaded object's type "${realMime}" is not allowed`, {
        code: ErrorCode.UNSUPPORTED_FILE_TYPE,
      });
    }
  }

  private async toAdminDTO(pc: VeterinarianStoreProductWithCategory): Promise<VeterinarianStoreAdminProductDTO> {
    const { product, categoryName } = pc;
    const imageRows = await this.products.listImages(product.id);
    const images = await Promise.all(
      imageRows.map(async (img) => ({
        id: img.id,
        url: (await resolveVeterinarianStoreImageUrlOrNull(this.storage, img.image_key)) ?? '',
        sortOrder: img.sort_order,
      })),
    );
    return {
      id: product.id,
      categoryId: product.categoryId,
      categoryName,
      name: product.name,
      description: product.description,
      price: product.price,
      currency: product.currency,
      stockQuantity: product.stockQuantity,
      status: product.status,
      primaryImageUrl: await resolveVeterinarianStoreImageUrlOrNull(this.storage, product.primaryImageKey),
      attributes: product.attributes,
      images: images.filter((i) => i.url),
      ratingAverage: product.ratingAverage,
      ratingCount: product.ratingCount,
      createdByUserId: product.createdByUserId,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private async categoryDTO(id: string): Promise<VeterinarianStoreCategoryDTO> {
    const c = await this.categories.findById(id);
    if (!c) throw new NotFoundError('Category not found');
    const counts = await this.categories.productCounts();
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      imageUrl: await resolveVeterinarianStoreImageUrlOrNull(this.storage, c.imageKey),
      showOnHome: c.showOnHome,
      sortOrder: c.sortOrder,
      status: c.status,
      productCount: counts.get(c.id) ?? 0,
    };
  }
}
