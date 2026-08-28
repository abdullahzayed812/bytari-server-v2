import type { Knex } from 'knex';
import { rowToCategory, type Category, type CategoryRow } from '../domain/content.types.js';

const T = 'categories';

export class CategoryRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async list(trx?: Knex.Transaction): Promise<Category[]> {
    const rows: CategoryRow[] = await this.conn(trx)<CategoryRow>(T)
      .whereNull('deleted_at')
      .orderBy('name');
    return rows.map(rowToCategory);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Category | null> {
    const row = await this.conn(trx)<CategoryRow>(T).where({ id }).whereNull('deleted_at').first();
    return row ? rowToCategory(row) : null;
  }

  async findExistingIds(ids: string[], trx?: Knex.Transaction): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows: Array<{ id: string }> = await this.conn(trx)(T)
      .whereIn('id', ids)
      .whereNull('deleted_at')
      .select('id');
    return new Set(rows.map((r) => r.id));
  }

  async create(
    data: { slug: string; name: string; description: string | null; createdByUserId: string },
    trx: Knex.Transaction,
  ): Promise<Category> {
    const [row] = (await trx(T)
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as CategoryRow[];
    if (!row) throw new Error('category insert returned no row');
    return rowToCategory(row);
  }

  async update(
    id: string,
    patch: { name?: string; description?: string | null },
    trx: Knex.Transaction,
  ): Promise<Category> {
    const dbPatch: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    const [row] = (await trx(T)
      .where({ id })
      .whereNull('deleted_at')
      .update(dbPatch)
      .returning('*')) as CategoryRow[];
    if (!row) throw new Error('category not found on update');
    return rowToCategory(row);
  }

  async softDelete(id: string, trx: Knex.Transaction): Promise<void> {
    await trx(T)
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: trx.fn.now(), updated_at: trx.fn.now() });
  }

  async slugExists(slug: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.conn(trx)(T).where({ slug }).whereNull('deleted_at').first();
    return Boolean(row);
  }
}
