import type { Knex } from 'knex';
import { rowToUser } from './user.mapper.js';
import type {
  CreateUserData,
  ListUsersFilter,
  UpdateUserData,
  User,
  UserRow,
} from './user.types.js';

const TABLE = 'users';

/** Data access for the `users` table. No business rules here. */
export class UserRepository {
  constructor(private readonly db: Knex) {}

  private table(trx?: Knex.Transaction): Knex.QueryBuilder<UserRow> {
    return (trx ?? this.db)<UserRow>(TABLE);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<User | null> {
    const row = await this.table(trx).where({ id }).first();
    return row ? rowToUser(row) : null;
  }

  async findByEmail(email: string, trx?: Knex.Transaction): Promise<User | null> {
    const row = await this.table(trx).where({ email }).first();
    return row ? rowToUser(row) : null;
  }

  async existsByEmail(email: string, trx?: Knex.Transaction): Promise<boolean> {
    const row = await this.table(trx).where({ email }).select('id').first();
    return Boolean(row);
  }

  async insert(data: CreateUserData, trx?: Knex.Transaction): Promise<User> {
    const [row] = await this.table(trx)
      .insert({
        email: data.email,
        password_hash: data.passwordHash,
        first_name: data.firstName,
        last_name: data.lastName,
        phone: data.phone ?? null,
        gender: data.gender ?? null,
        country: data.country ?? null,
      })
      .returning('*');
    return rowToUser(row as UserRow);
  }

  async update(id: string, patch: UpdateUserData, trx?: Knex.Transaction): Promise<User> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.firstName !== undefined) dbPatch.first_name = patch.firstName;
    if (patch.lastName !== undefined) dbPatch.last_name = patch.lastName;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.gender !== undefined) dbPatch.gender = patch.gender;
    if (patch.country !== undefined) dbPatch.country = patch.country;
    if (patch.avatarKey !== undefined) dbPatch.avatar_key = patch.avatarKey;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.veterinarianStatus !== undefined)
      dbPatch.veterinarian_status = patch.veterinarianStatus;
    if (patch.passwordHash !== undefined) dbPatch.password_hash = patch.passwordHash;

    const [row] = await this.table(trx).where({ id }).update(dbPatch).returning('*');
    return rowToUser(row as UserRow);
  }

  async list(
    filter: ListUsersFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: User[]; total: number }> {
    const base = this.table(trx);
    const applyFilters = (qb: Knex.QueryBuilder<UserRow>): Knex.QueryBuilder<UserRow> => {
      if (filter.status) qb.where('status', filter.status);
      if (filter.veterinarianStatus) qb.where('veterinarian_status', filter.veterinarianStatus);
      if (filter.search) {
        const like = `%${filter.search.toLowerCase()}%`;
        qb.where((w) => {
          w.whereRaw('lower(email::text) like ?', [like])
            .orWhereRaw('lower(first_name) like ?', [like])
            .orWhereRaw('lower(last_name) like ?', [like]);
        });
      }
      return qb;
    };

    const countRow = await applyFilters(base.clone())
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: UserRow[] = await applyFilters(base.clone())
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map((r) => rowToUser(r)), total };
  }
}
