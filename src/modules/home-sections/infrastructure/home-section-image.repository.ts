import type { Knex } from 'knex';
import type { HomeSectionKey } from '../domain/home-section.constants.js';

const TABLE = 'home_section_images';

export interface HomeSectionImageRow {
  section_key: string;
  image_key: string;
  image_storage_provider: string | null;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class HomeSectionImageRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  listAll(): Promise<HomeSectionImageRow[]> {
    return this.db<HomeSectionImageRow>(TABLE).select('*');
  }

  async find(key: HomeSectionKey, trx?: Knex.Transaction): Promise<HomeSectionImageRow | null> {
    const row = await this.conn(trx)<HomeSectionImageRow>(TABLE)
      .where({ section_key: key })
      .first();
    return row ?? null;
  }

  async upsert(
    key: HomeSectionKey,
    data: { imageKey: string; storageProvider: string; updatedByUserId: string },
    trx: Knex.Transaction,
  ): Promise<void> {
    await trx(TABLE)
      .insert({
        section_key: key,
        image_key: data.imageKey,
        image_storage_provider: data.storageProvider,
        updated_by_user_id: data.updatedByUserId,
      })
      .onConflict('section_key')
      .merge({
        image_key: data.imageKey,
        image_storage_provider: data.storageProvider,
        updated_by_user_id: data.updatedByUserId,
        updated_at: trx.fn.now(),
      });
  }

  async remove(key: HomeSectionKey, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ section_key: key }).del();
  }
}
