import type { Logger } from 'pino';
import { ForbiddenError } from '../../shared/errors/app-error.js';
import type { AuthorizationService } from '../authorization/authorization.service.js';
import type { AuthPrincipal } from '../authorization/authorization.types.js';
import type { ContentService } from '../content/application/content.service.js';
import type { NewsService } from '../content/application/news.service.js';
import type { TipService } from '../content/application/tip.service.js';
import type { OrganizationService } from '../organizations/application/organization.service.js';
import type { PetStoreCatalogService } from '../pet-owner-store/application/pet-owner-store-catalog.service.js';
import type { VeterinarianStoreCatalogService } from '../veterinarian-store/application/veterinarian-store-catalog.service.js';
import type { VetCourseService } from '../vet-courses/application/vet-course.service.js';
import type { VetJobOfferService } from '../vet-jobs/application/vet-job-offer.service.js';
import type { VetServiceListingService } from '../vet-services/application/vet-service-listing.service.js';

/** Everything the Home header search can find. */
export const SEARCH_TYPES = [
  'BOOK',
  'MAGAZINE',
  'PET_STORE_PRODUCT',
  'VET_STORE_PRODUCT',
  'CLINIC',
  'VETERINARY_OFFICE',
  'FARM',
  'SERVICE',
  'COURSE',
  'JOB',
  'NEWS',
  'TIP',
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/**
 * The application interface a search runs in. Each interface only ever
 * searches its OWN sections — a Pet Owner never gets veterinarian-only
 * entities (books, magazines, courses, jobs, the Veterinarian Store, offices)
 * and the Veterinarian interface never gets the Pet Owner sections (pet store,
 * clinics, own farms, news/tips). Vet services exist in both interfaces.
 */
export const SEARCH_INTERFACES = ['PET_OWNER', 'VETERINARIAN'] as const;
export type SearchInterface = (typeof SEARCH_INTERFACES)[number];

export const INTERFACE_SEARCH_TYPES: Record<SearchInterface, readonly SearchType[]> = {
  PET_OWNER: ['PET_STORE_PRODUCT', 'CLINIC', 'FARM', 'SERVICE', 'NEWS', 'TIP'],
  VETERINARIAN: [
    'BOOK',
    'MAGAZINE',
    'VET_STORE_PRODUCT',
    'VETERINARY_OFFICE',
    'SERVICE',
    'COURSE',
    'JOB',
  ],
};

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  /** Type-specific routing hints (FARM → `farmSpecies`). */
  meta?: Record<string, string>;
}

export interface SearchGroup {
  type: SearchType;
  items: SearchHit[];
  /** Total matches for this type (for "see all"). */
  total: number;
}

export interface SearchDeps {
  authz: AuthorizationService;
  content: ContentService;
  news: NewsService;
  tips: TipService;
  organizations: OrganizationService;
  petStore: PetStoreCatalogService;
  vetStore: VeterinarianStoreCatalogService;
  courses: VetCourseService;
  jobs: VetJobOfferService;
  services: VetServiceListingService;
}

type Finder = (
  q: string,
  limit: number,
  principal: AuthPrincipal,
) => Promise<{ items: SearchHit[]; total: number }>;

/**
 * Global application search ("بحث" in the Home header). Deliberately NOT a new
 * index: every type delegates to the SAME public list service its own screen
 * uses, with that service's `search` filter and a small page — so each type
 * keeps its existing visibility rules (published / approved / active /
 * not-expired only; farms = the caller's own memberships; the Veterinarian
 * Store only for approved vets) and nothing is loaded wholesale. Types run in
 * parallel; one failing source never breaks the whole response.
 */
export class SearchService {
  private readonly log: Logger;
  private readonly finders: Record<SearchType, Finder>;

  constructor(
    private readonly deps: SearchDeps,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'search-service' });
    const page = (limit: number) => ({ page: 1, pageSize: limit });

    const content =
      (type: 'BOOK' | 'MAGAZINE'): Finder =>
      async (q, limit, p) => {
        const r = await deps.content.listPublic({
          ...page(limit),
          type,
          search: q,
          viewerId: p.userId,
        });
        return {
          total: r.total,
          items: r.items.map((c) => ({
            type,
            id: c.id,
            title: c.title,
            subtitle: c.authorName,
            imageUrl: c.coverUrl,
          })),
        };
      };

    const directory =
      (type: 'CLINIC' | 'VETERINARY_OFFICE'): Finder =>
      async (q, limit) => {
        const r = await deps.organizations.discoverPublic({ ...page(limit), type, search: q });
        return {
          total: r.total,
          items: r.items.map((o) => ({
            type,
            id: o.id,
            title: o.name,
            subtitle: o.address ?? o.description,
            imageUrl: o.logoUrl,
          })),
        };
      };

    this.finders = {
      BOOK: content('BOOK'),
      MAGAZINE: content('MAGAZINE'),
      CLINIC: directory('CLINIC'),
      VETERINARY_OFFICE: directory('VETERINARY_OFFICE'),
      PET_STORE_PRODUCT: async (q, limit) => {
        const r = await deps.petStore.listProducts({ ...page(limit), search: q });
        return {
          total: r.total,
          items: r.items.map((p) => ({
            type: 'PET_STORE_PRODUCT' as const,
            id: p.id,
            title: p.name,
            subtitle: p.categoryName,
            imageUrl: p.primaryImageUrl,
          })),
        };
      },
      VET_STORE_PRODUCT: async (q, limit, p) => {
        // The Veterinarian Store is a veterinarian-mode storefront.
        if (!deps.authz.isAdmin(p) && !deps.authz.isApprovedVeterinarian(p)) {
          return { items: [], total: 0 };
        }
        const r = await deps.vetStore.listProducts({ ...page(limit), search: q });
        return {
          total: r.total,
          items: r.items.map((x) => ({
            type: 'VET_STORE_PRODUCT' as const,
            id: x.id,
            title: x.name,
            subtitle: x.categoryName,
            imageUrl: x.primaryImageUrl,
          })),
        };
      },
      FARM: async (q, limit, p) => {
        // Farms are never publicly browsable — only the caller's own memberships.
        const needle = q.toLocaleLowerCase();
        const mine = (await deps.organizations.listMine(p.userId)).filter(
          (o) => o.type === 'FARM' && o.name.toLocaleLowerCase().includes(needle),
        );
        return {
          total: mine.length,
          items: mine.slice(0, limit).map((o) => ({
            type: 'FARM' as const,
            id: o.id,
            title: o.name,
            subtitle: o.location ?? o.governorate,
            imageUrl: o.imageUrl,
            ...(o.farmSpecies ? { meta: { farmSpecies: o.farmSpecies } } : {}),
          })),
        };
      },
      SERVICE: async (q, limit) => {
        const r = await deps.services.listPublic({ ...page(limit), search: q });
        return {
          total: r.total,
          items: r.items.map((s) => ({
            type: 'SERVICE' as const,
            id: s.id,
            title: s.title,
            subtitle: `${s.veterinarian.firstName} ${s.veterinarian.lastName}`.trim(),
            imageUrl: s.imageUrls[0] ?? null,
          })),
        };
      },
      COURSE: async (q, limit, p) => {
        const r = await deps.courses.listPublic({ ...page(limit), search: q }, p.userId);
        return {
          total: r.total,
          items: r.items.map((c) => ({
            type: 'COURSE' as const,
            id: c.id,
            title: c.title,
            subtitle: c.organizingBody,
            imageUrl: c.coverImageUrl,
          })),
        };
      },
      JOB: async (q, limit) => {
        const r = await deps.jobs.listPublic({ ...page(limit), search: q });
        return {
          total: r.total,
          items: r.items.map((j) => ({
            type: 'JOB' as const,
            id: j.id,
            title: j.title,
            subtitle: j.organizationName,
            imageUrl: null,
          })),
        };
      },
      NEWS: async (q, limit, p) => {
        const r = await deps.news.listPublicNews(p.userId, { ...page(limit), search: q });
        return {
          total: r.total,
          items: r.items.map((n) => ({
            type: 'NEWS' as const,
            id: n.id,
            title: n.title,
            subtitle: n.summary,
            imageUrl: n.coverImageUrl,
          })),
        };
      },
      TIP: async (q, limit, p) => {
        const r = await deps.tips.listPublicTips(p.userId, { ...page(limit), search: q });
        return {
          total: r.total,
          items: r.items.map((t) => ({
            type: 'TIP' as const,
            id: t.id,
            title: t.title,
            subtitle: t.summary,
            imageUrl: t.coverImageUrl,
          })),
        };
      },
    };
  }

  async search(
    principal: AuthPrincipal,
    input: { q: string; interface: SearchInterface; types?: SearchType[]; limit: number },
  ): Promise<{ query: string; interface: SearchInterface; groups: SearchGroup[] }> {
    const q = input.q.trim();
    // The Veterinarian interface is only for approved veterinarians (and admins).
    if (
      input.interface === 'VETERINARIAN' &&
      !this.deps.authz.isAdmin(principal) &&
      !this.deps.authz.isApprovedVeterinarian(principal)
    ) {
      throw new ForbiddenError(
        'The veterinarian interface search requires an approved veterinarian',
      );
    }
    const allowed = INTERFACE_SEARCH_TYPES[input.interface];
    // Requested types are always narrowed to the interface's own sections.
    const types = input.types?.length
      ? input.types.filter((t) => allowed.includes(t))
      : [...allowed];
    const groups = await Promise.all(
      types.map(async (type): Promise<SearchGroup> => {
        try {
          const r = await this.finders[type](q, input.limit, principal);
          return { type, items: r.items, total: r.total };
        } catch (err) {
          this.log.warn({ err, type }, 'search source failed — skipped');
          return { type, items: [], total: 0 };
        }
      }),
    );
    return { query: q, interface: input.interface, groups: groups.filter((g) => g.total > 0) };
  }
}
