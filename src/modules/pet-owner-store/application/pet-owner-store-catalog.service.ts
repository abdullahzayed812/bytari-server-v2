import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import type {
  ListPetStoreProductsFilter,
  PetStoreCategoryDTO,
  PetStoreProductDetailDTO,
  PetStoreProductListItemDTO,
} from '../domain/pet-owner-store.types.js';
import type { PetStoreCategoryRepository } from '../infrastructure/category.repository.js';
import type {
  PetStoreProductRepository,
  PetStoreProductWithCategory,
} from '../infrastructure/product.repository.js';
import { resolvePetStoreImageUrlOrNull } from './pet-owner-store-media.js';

/**
 * Consumer read side of the Pet Owners Store — categories + product catalogue.
 * Every route that reaches this needs only authentication (any logged-in user).
 * Only ACTIVE products / categories are ever returned here.
 */
export class PetStoreCatalogService {
  private readonly log: Logger;

  constructor(
    private readonly categories: PetStoreCategoryRepository,
    private readonly products: PetStoreProductRepository,
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'pet-store-catalog-service' });
  }

  async listCategories(opts: { homeOnly?: boolean } = {}): Promise<PetStoreCategoryDTO[]> {
    const rows = await this.categories.list({
      activeOnly: true,
      showOnHomeOnly: opts.homeOnly ?? false,
    });
    return Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        imageUrl: await resolvePetStoreImageUrlOrNull(this.storage, c.imageKey),
        showOnHome: c.showOnHome,
        sortOrder: c.sortOrder,
        status: c.status,
      })),
    );
  }

  async listProducts(
    filter: ListPetStoreProductsFilter,
  ): Promise<{ items: PetStoreProductListItemDTO[]; total: number }> {
    const { items, total } = await this.products.list({ ...filter, status: 'ACTIVE' });
    return { items: await Promise.all(items.map((pc) => this.toListItem(pc))), total };
  }

  async getProduct(id: string): Promise<PetStoreProductDetailDTO> {
    const found = await this.products.findWithCategory(id);
    if (!found || found.product.status !== 'ACTIVE') throw new NotFoundError('Product not found');

    const base = await this.toListItem(found);
    const imageRows = await this.products.listImages(id);
    const images = await Promise.all(
      imageRows.map(async (img) => ({
        id: img.id,
        url: (await resolvePetStoreImageUrlOrNull(this.storage, img.image_key)) ?? '',
        sortOrder: img.sort_order,
      })),
    );

    return {
      ...base,
      description: found.product.description,
      stockQuantity: found.product.stockQuantity,
      attributes: found.product.attributes,
      images: images.filter((i) => i.url),
    };
  }

  private async toListItem(pc: PetStoreProductWithCategory): Promise<PetStoreProductListItemDTO> {
    const { product, categoryName } = pc;
    return {
      id: product.id,
      categoryId: product.categoryId,
      categoryName,
      name: product.name,
      price: product.price,
      currency: product.currency,
      inStock: product.stockQuantity > 0,
      status: product.status,
      primaryImageUrl: await resolvePetStoreImageUrlOrNull(this.storage, product.primaryImageKey),
      ratingAverage: product.ratingAverage,
      ratingCount: product.ratingCount,
    };
  }
}
