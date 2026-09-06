import type { Knex } from 'knex';
import type { FarmProfileRow } from '../domain/poultry-ops.types.js';

const TABLE = 'farm_details';

export interface FarmProfilePatch {
  location?: string | null;
  governorate?: string | null;
  address?: string | null;
  capacity?: number | null;
  currentBirdCount?: number | null;
  establishedOn?: string | null;
  poultryProductionType?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  imageKey?: string | null;
  imageProvider?: string | null;
  farmSpecies?: string | null;
  currentSheepCount?: number | null;
  currentCattleCount?: number | null;
  sheepProductionType?: string | null;
  cattleProductionType?: string | null;
}

/**
 * Reads / writes the Poultry-Farm profile columns added to `farm_details`
 * (`20260912010000_poultry_operations.ts`). The join-code operations stay in
 * {@link FarmDetailsRepository}.
 */
export class FarmProfileRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findByOrganizationId(
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<FarmProfileRow | undefined> {
    return this.conn(trx)<FarmProfileRow>(TABLE).where({ organization_id: organizationId }).first();
  }

  async update(
    organizationId: string,
    patch: FarmProfilePatch,
    trx: Knex.Transaction,
  ): Promise<number> {
    const dbPatch: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.location !== undefined) dbPatch.location = patch.location;
    if (patch.governorate !== undefined) dbPatch.governorate = patch.governorate;
    if (patch.address !== undefined) dbPatch.address = patch.address;
    if (patch.capacity !== undefined) dbPatch.capacity = patch.capacity;
    if (patch.currentBirdCount !== undefined) dbPatch.current_bird_count = patch.currentBirdCount;
    if (patch.establishedOn !== undefined) dbPatch.established_on = patch.establishedOn;
    if (patch.poultryProductionType !== undefined)
      dbPatch.poultry_production_type = patch.poultryProductionType;
    if (patch.contactName !== undefined) dbPatch.contact_name = patch.contactName;
    if (patch.contactPhone !== undefined) dbPatch.contact_phone = patch.contactPhone;
    if (patch.contactEmail !== undefined) dbPatch.contact_email = patch.contactEmail;
    if (patch.imageKey !== undefined) dbPatch.image_key = patch.imageKey;
    if (patch.imageProvider !== undefined) dbPatch.image_provider = patch.imageProvider;
    if (patch.farmSpecies !== undefined) dbPatch.farm_species = patch.farmSpecies;
    if (patch.currentSheepCount !== undefined) dbPatch.current_sheep_count = patch.currentSheepCount;
    if (patch.currentCattleCount !== undefined) dbPatch.current_cattle_count = patch.currentCattleCount;
    if (patch.sheepProductionType !== undefined) dbPatch.sheep_production_type = patch.sheepProductionType;
    if (patch.cattleProductionType !== undefined)
      dbPatch.cattle_production_type = patch.cattleProductionType;
    if (Object.keys(dbPatch).length === 1) return 0;
    return trx(TABLE).where({ organization_id: organizationId }).update(dbPatch);
  }
}
