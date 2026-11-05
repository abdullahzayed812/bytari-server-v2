import type { ObjectStorage } from '../../../infra/storage/index.js';
import { resolveStorageUrlOrNull } from '../../../shared/storage/media-url.js';
import type {
  PoultrySupervisionFarm,
  PoultrySupervisionLink,
  PoultrySupervisionListFilter,
  PoultrySupervisionSummary,
  PoultrySupervisionVeterinarian,
} from '../domain/poultry-supervision.types.js';
import type {
  FarmRecord,
  PoultrySupervisionRepository,
  VeterinarianRecord,
} from '../infrastructure/poultry-supervision.repository.js';

const MEDIA_URL_TTL_SECONDS = 3600;

/**
 * Admin "Poultry Supervisors Management" — read-only views over the existing
 * farm ↔ veterinarian memberships (see `poultry-supervision.types.ts` for the
 * link definition). Resolves avatar / farm photo keys to URLs; never writes.
 */
export class PoultrySupervisionService {
  constructor(
    private readonly repo: PoultrySupervisionRepository,
    private readonly storage: ObjectStorage,
  ) {}

  private async vet(r: VeterinarianRecord): Promise<PoultrySupervisionVeterinarian> {
    const { avatarKey, ...rest } = r;
    return {
      ...rest,
      avatarUrl: await resolveStorageUrlOrNull(this.storage, avatarKey, MEDIA_URL_TTL_SECONDS),
    };
  }

  private async farm(r: FarmRecord): Promise<PoultrySupervisionFarm> {
    const { imageKey, ...rest } = r;
    return {
      ...rest,
      imageUrl: await resolveStorageUrlOrNull(this.storage, imageKey, MEDIA_URL_TTL_SECONDS),
    };
  }

  summary(): Promise<PoultrySupervisionSummary> {
    return this.repo.summary();
  }

  async listLinked(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: PoultrySupervisionLink[]; total: number }> {
    const { items, total } = await this.repo.listLinked(filter);
    return {
      total,
      items: await Promise.all(
        items.map(async (l) => ({
          membershipId: l.membershipId,
          role: l.role,
          assignedAt: l.assignedAt,
          veterinarian: await this.vet(l.veterinarian),
          farm: await this.farm(l.farm),
        })),
      ),
    };
  }

  async listUnlinkedFarms(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: PoultrySupervisionFarm[]; total: number }> {
    const { items, total } = await this.repo.listUnlinkedFarms(filter);
    return { total, items: await Promise.all(items.map((f) => this.farm(f))) };
  }

  async listUnlinkedVeterinarians(
    filter: PoultrySupervisionListFilter,
  ): Promise<{ items: PoultrySupervisionVeterinarian[]; total: number }> {
    const { items, total } = await this.repo.listUnlinkedVeterinarians(filter);
    return { total, items: await Promise.all(items.map((v) => this.vet(v))) };
  }
}
