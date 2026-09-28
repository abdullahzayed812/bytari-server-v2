import type { Knex } from 'knex';
import type { SyndicateRegistrationStatus } from '../domain/syndicate.constants.js';

const T = 'syndicate_registrations';

export interface SyndicateRegistration {
  id: string;
  organizationId: string;
  userId: string;
  status: SyndicateRegistrationStatus;
  registeredAt: Date;
  endedAt: Date | null;
}

/** A registration joined with the member's basic account fields (never credentials). */
export interface SyndicateRegistrationWithUser extends SyndicateRegistration {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  country: string | null;
  governorate: string | null;
  specialization: string | null;
  avatarKey: string | null;
  veterinarianStatus: string;
}

interface Row {
  id: string;
  organization_id: string;
  user_id: string;
  status: SyndicateRegistrationStatus;
  registered_at: Date;
  ended_at: Date | null;
}

interface RowWithUser extends Row {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  country: string | null;
  governorate: string | null;
  specialization: string | null;
  avatar_key: string | null;
  veterinarian_status: string;
}

function toRegistration(r: Row): SyndicateRegistration {
  return {
    id: r.id,
    organizationId: r.organization_id,
    userId: r.user_id,
    status: r.status,
    registeredAt: r.registered_at,
    endedAt: r.ended_at,
  };
}

function toWithUser(r: RowWithUser): SyndicateRegistrationWithUser {
  return {
    ...toRegistration(r),
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    country: r.country,
    governorate: r.governorate,
    specialization: r.specialization,
    avatarKey: r.avatar_key,
    veterinarianStatus: r.veterinarian_status,
  };
}

const USER_COLUMNS = [
  'u.first_name',
  'u.last_name',
  'u.email',
  'u.phone',
  'u.country',
  'u.governorate',
  'u.specialization',
  'u.avatar_key',
  'u.veterinarian_status',
];

export class SyndicateRegistrationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findActive(
    organizationId: string,
    userId: string,
    trx?: Knex.Transaction,
  ): Promise<SyndicateRegistration | null> {
    const row = await this.conn(trx)<Row>(T)
      .where({ organization_id: organizationId, user_id: userId, status: 'ACTIVE' })
      .first();
    return row ? toRegistration(row) : null;
  }

  async findActiveWithUser(
    organizationId: string,
    userId: string,
  ): Promise<SyndicateRegistrationWithUser | null> {
    const row = (await this.db(`${T} as r`)
      .join('users as u', 'u.id', 'r.user_id')
      .where({ 'r.organization_id': organizationId, 'r.user_id': userId, 'r.status': 'ACTIVE' })
      .first('r.*', ...USER_COLUMNS));
    return row ? toWithUser(row) : null;
  }

  async create(
    organizationId: string,
    userId: string,
    trx: Knex.Transaction,
  ): Promise<SyndicateRegistration> {
    const [row] = (await trx(T)
      .insert({ organization_id: organizationId, user_id: userId, status: 'ACTIVE' })
      .returning('*')) as Row[];
    if (!row) throw new Error('syndicate_registrations insert returned no row');
    return toRegistration(row);
  }

  /** Ends one ACTIVE registration. Returns `false` when there was none. */
  async end(
    id: string,
    status: 'CANCELLED' | 'REMOVED',
    endedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<boolean> {
    const n = await trx(T).where({ id, status: 'ACTIVE' }).update({
      status,
      ended_at: trx.fn.now(),
      ended_by_user_id: endedByUserId,
      updated_at: trx.fn.now(),
    });
    return n > 0;
  }

  /** Ends every ACTIVE registration of a syndicate (syndicate deletion). */
  async endAllForOrganization(
    organizationId: string,
    endedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx(T).where({ organization_id: organizationId, status: 'ACTIVE' }).update({
      status: 'REMOVED',
      ended_at: trx.fn.now(),
      ended_by_user_id: endedByUserId,
      updated_at: trx.fn.now(),
    });
  }

  async countActive(organizationId: string): Promise<number> {
    const row = await this.db(T)
      .where({ organization_id: organizationId, status: 'ACTIVE' })
      .count<{ count: string }>({ count: '*' })
      .first();
    return Number(row?.count ?? 0);
  }

  async listActiveWithUsers(
    organizationId: string,
    filter: { search?: string; page: number; pageSize: number },
  ): Promise<{ items: SyndicateRegistrationWithUser[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where({ 'r.organization_id': organizationId, 'r.status': 'ACTIVE' });
      if (filter.search) {
        const s = `%${filter.search}%`;
        qb.andWhere((w) => {
          w.whereILike('u.first_name', s)
            .orWhereILike('u.last_name', s)
            .orWhereILike('u.email', s)
            .orWhereILike('u.phone', s);
        });
      }
      return qb;
    };
    const base = () => this.db(`${T} as r`).join('users as u', 'u.id', 'r.user_id');
    const countRow = await scope(base()).count<{ count: string }>({ count: '*' }).first();
    const rows = (await scope(base())
      .orderBy('r.registered_at', 'desc')
      .orderBy('r.id', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('r.*', ...USER_COLUMNS));
    return { items: rows.map(toWithUser), total: Number(countRow?.count ?? 0) };
  }

  /** ACTIVE members' user ids — the "رسالة إلى الأعضاء" fan-out. */
  async listActiveUserIds(organizationId: string, limit: number): Promise<string[]> {
    const rows: Array<{ user_id: string }> = await this.db(T)
      .where({ organization_id: organizationId, status: 'ACTIVE' })
      .orderBy('registered_at', 'asc')
      .limit(limit)
      .select('user_id');
    return rows.map((r) => r.user_id);
  }
}
